import { fetchuc, fetchc } from './../src/fetch.js';
import { world } from './../src/world.js';
import { queues, ee, HEADERS } from './../src/general.js';

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

// Queue an initial lookup of live wikibase.world wikis
queues.many.add(async () => {
    const url = "https://www.wikibase.cloud/api/wiki?sort=pages&direction=desc&is_active=1&page=1&per_page=99999";
    const response = await fetchuc(url);
    const data = await response.json();
    const wikis = data.data;

    // sort the wikis by id, desc
    wikis.sort((a, b) => b.id - a.id)

    const worldWikis = await world.sparql.wikis();
    const worldWikiURLs = worldWikis.map(wiki => wiki.site)
    const worldWikiItems = worldWikis.map(wiki => wiki.item)

    wikis.forEach(async wiki => {
        if (scriptFilter != undefined && !wiki.domain.includes(scriptFilter)) {
            return
        }

        // Check if the wiki is alive, one at a time so as to not overload cloud
        queues.four.add(async () => {
            const url = "https://" + wiki.domain
            try{
                const response = await fetchc(url, { headers: HEADERS })
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
                            console.log(`❌ The wikibase ${wbURL} does not have an item in the world, even though we thought it did.. lol.`)
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

        });

    });
});

// Listen for alive wikis
ee.on('cloud.wikis.new', ({ wiki, response }) => {
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
    });
});