import { simplifyClaims } from 'wikibase-sdk'
import { fetchuc, fetchc } from './../src/fetch.js';
import { world } from './../src/world.js';
import { queues, ee, HEADERS } from './../src/general.js';
import process from 'process';

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

// Queue an initial lookup of live wikibase.world wikis
queues.many.add(async () => {
    const url = "https://www.wikibase.cloud/api/wiki?sort=pages&direction=desc&page=1&per_page=99999";
    const response = await fetchuc(url);
    const data = await response.json();
    // Make sure that the per_page element matches 99999
    if (data.meta.per_page != 99999) {
        console.log(`❌ The per_page element in the response is not 99999, it is ${data.meta.per_page}`)
        return
    }
    // And make sure that the to element is 99999 or less
    if (data.meta.to > 99999) {
        console.log(`❌ The to element in the response is greater than 99999, it is ${data.meta.to}`)
        return
    }
    // So we probably have ALL the wikibase.cloud wikis, and they didn't change the API limits etc on us
    const wikis = data.data;

    // sort the wikis by id, desc (so newest first)
    wikis.sort((a, b) => b.id - a.id)

    const worldWikis = await world.sparql.wikis();
    const worldCloudWikis = await world.sparql.cloudWikis();
    const worldWikiURLs = worldWikis.map(wiki => wiki.site)
    const worldWikiItems = worldWikis.map(wiki => wiki.item)

    // Add wikibase.cloud wikis that don't yet exist
    wikis.forEach(async wiki => {
        if (scriptFilter != undefined && !wiki.domain.includes(scriptFilter)) {
            return
        }

        // Check if the wiki is alive, one at a time so as to not overload cloud
        queues.four.add(async () => {
            const url = "https://" + wiki.domain
            try{
                const response = await fetchc(url, { headers: HEADERS })
                if (!response) {
                    console.log(`❌ The URL ${url} failed to fetch (connection error or timeout)`)
                    return
                }
                const responseText = await response.text();
                response.loadedText = responseText
                if (response.status == 200 || ( response.status === 404 && responseText.includes("There is currently no text in this page") ) ) {
                    // Make sure it doesnt already exist, so make sure the domain doesnt appear in any of the strings in worldWikiURLs
                    if (!worldWikiURLs.some(wikiURL => wikiURL.includes(wiki.domain))) {
                        ee.emit('cloud.wikis.new', { wiki: wiki, response: response })
                    } else {
                        let itemID = undefined
                        for (let i = 0; i < worldWikiURLs.length; i++) {
                            if (worldWikiURLs[i].includes(wiki.domain)) {
                                itemID = worldWikiItems[i]
                                break
                            }
                        }

                        if (!itemID) {
                            console.log(`❌ The wikibase ${wiki.domain} does not have an item in the world, even though we thought it did.. lol.`)
                            return
                        }

                        // ensure the cloud ID statement is set!
                        world.queueWork.claimEnsure(queues.one, { id: itemID, property: 'P54', value: `${wiki.id}` }, { summary: `Add [[Property:P54]] for a known https://wikibase.cloud Wikibase` })
                    }

                } else {
                    console.log(`❌ The URL ${url} is not currently a 200 or a 404 with the expected text (should be, as it is a live cloud wiki...)`)
                    return
                }
            } catch (e) {
                console.log(`❌ The URL ${url} is not currently a 200 (should be, as it is a live cloud wiki...)` + e)
                return
            }

        }, { jobName: `checkWiki: ${wiki.domain}` });

    });

    // Mark deleted wikibase.cloud wikis as permanently offline
    // TODO maybe only query for the non deleted wikibase world cloud wikis?
    worldCloudWikis.forEach(async wiki => {
        if (scriptFilter != undefined && !wiki.site.includes(scriptFilter)) {
            return
        }

        // set wiki.domain, by removing the https:// and any path
        wiki.domain = wiki.site.replace(/^https?:\/\//, '').split('/')[0]


        const isWikiInList = wikis.some(w => w.domain.includes(wiki.domain));
        console.log(`Site ${wiki.site} world list check, is in list: ${isWikiInList}`)
        if (!isWikiInList) {
            console.log(wiki.domain)
            

            // Lookup the item for the site on wikibase.world
            const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS }).then(
                res => {
                    if (res) {
                        return res.json();
                    }
                    return { entities: {} };
                }
            );
            if (!entities[wiki.item]) {
                console.log(`❌ The item ${wiki.item} does not exist`);
                return;
            }
            wiki.entity = entities[wiki.item];
            wiki.simpleClaims = simplifyClaims(wiki.entity.claims);

            // Check if there is a P13 claim
            if (wiki.simpleClaims.P13 && wiki.simpleClaims.P13.length > 0) {
                // If there is more than 1 P13 claim
                if (wiki.simpleClaims.P13.length > 1) {
                    console.log(`❌ The item ${wiki.item} has more than 1 P13 claim`)
                } else {
                    if (wiki.simpleClaims.P13[0] === 'Q57') {
                        console.log(`❌ The item ${wiki.item} already has a P13 claim with value Q57`)
                    } else {
                        // Update the P13 claim to Q57
                        world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P13', oldValue: wiki.simpleClaims.P13[0], newValue: 'Q57' }, { summary: `Update [[Property:P13]] claim to [[Item:Q57]] for a deleted [[Item:Q8]] Wikibase` })
                    }
                }
            } else {
                // Add the P13 claim with value Q57
                world.queueWork.claimAdd(queues.one, { id: wiki.item, property: 'P13', value: 'Q57' }, { summary: `Add [[Property:P13]] claim with value [[Item:Q57]] for a deleted [[Item:Q8]] Wikibase` })
            }
        }
    });
}, { jobName: `fetchCloudWikis` });

// Listen for alive wikis
ee.on('cloud.wikis.new', ({ wiki }) => {
    queues.many.add(async () => {
        const url = "https://" + wiki.domain
        const name = wiki.sitename

        // Create the item
        world.queueWork.itemCreate(queues.one, {
            labels: { en: name },
            aliases: { en: [ wiki.domain ] },
            claims: {
                // Provide a basic set of claims, but let other things be filled in later.. (by the tidy)
                P1 : url,
                P2: "Q8", // wikibase.cloud
                P3: "Q10", // wikibase site
                P13: 'Q54', // active
                P49: url + "/wiki/Main_Page",
                P54: `${wiki.id}`,
            }
        }, { summary: `Importing https://${wiki.domain} from [[Item:Q8]] active wikis list` });
    }, { jobName: `createWiki: ${wiki.domain}` });
});