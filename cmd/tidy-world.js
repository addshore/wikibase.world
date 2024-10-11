import { simplifyClaims } from 'wikibase-sdk'
import { fetchuc, fetchc } from './../src/fetch.js';
import { world } from './../src/world.js';
import { queues, ee, HEADERS } from './../src/general.js';
import { metadatalookup } from './../src/metadata.js'
import dns from 'dns'

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

// Queue an initial lookup of live wikibase.world wikis
queues.many.add(async () => {
    let results = await world.sparql.wikis()

    // shuffle the wikis, for a bit of randomness :)
    results.sort(() => Math.random() - 0.5);

    // Emit a 'world.wikis' event for each wiki found
    results.forEach(async (result) => {
        if (scriptFilter != undefined && !result.site.includes(scriptFilter)) {
            return
        }
        ee.emit('world.wikis', result)
    });
});

// Listen for the 'world.wikis' event and queue a check for each wiki
ee.on('world.wikis', (result) => {
    // TODO order wikis with highest Qid first
    queues.many.add(async () => {
        const url = result.site
        try{
            const response = await fetchc(url, { headers: HEADERS })
            const responseText = await response.text();
            response.loadedText = responseText
            if (response.status == 200 || ( response.status === 404 && responseText.includes("There is currently no text in this page") ) ) {
                ee.emit('world.wikis.alive', { wiki: result, response: response })
            } else {
                console.log(`❌ The URL ${url} is not currently a 200 or a 404 with the expected text`)
                return
            }
        } catch (e) {
            console.log(`❌ The URL ${url} is not currently a 200`)
            return
        }
    });
});

ee.on('world.wikis.alive', async ({ wiki, response }) => {
    const url = world.sdk.getEntities({ids: [ wiki.item ]})
    const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
    const entity = entities[wiki.item]
    const simpleClaims = simplifyClaims(entity.claims)
    const responseText = response.loadedText

    // First, a very basic check to see if the URL is a MediaWiki, otherwise just RUN AWAY!
    const urlIsMediaWiki = responseText.includes('content="MediaWiki')
    if (!urlIsMediaWiki) {
        console.log(`❌ The URL ${wiki.site} is not a MediaWiki, aborting for now...`)
        return
    }

    // figure out the domain, by removing the protocol and the path
    const domain = wiki.site.replace('https://', '').replace('http://', '').split('/')[0]

    // loolkup the IP, then do a reverse lookup to get the domain
    const reverseDNS = await new Promise((resolve, reject) => {
        dns.lookup(domain, (err, address, family) => {
            if (err) {
                console.log(`❌ Failed to lookup the IP for ${domain}`);
                resolve([]);
            } else {
                dns.reverse(address, (err, hostnames) => {
                    if (err) {
                        // console.log(`❌ Failed to perform reverse DNS lookup for ${address}`);
                        resolve([]);
                    } else {
                        resolve(hostnames);
                    }
                });
            }
        });
    });
    // TODO do more with these reverse DNS results
    const REVERSE_CLOUD = "221.76.141.34.bc.googleusercontent.com";
    // const REVERSE_WBWIKI = "server-54-230-10-103.man50.r.cloudfront.net" // TODO check this one
    const REVERSE_WBWIKI = "server-108-138-217-36.lhr61.r.cloudfront.net"
    const REVERSE_WIKIMEDIA = "text-lb.esams.wikimedia.org"
    const REVERSE_WIKITIDE = "cp37.wikitide.net"

    // We should be able to parse an action API from the page too
    // It is like <link rel="EditURI" type="application/rsd+xml" href="https://wikibase.world/w/api.php?action=rsd"/>
    // And we want https://wikibase.world/w/api.php
    const actionApi = (() => {
        let actionApiMatchs = responseText.match(/<link rel="EditURI" type="application\/rsd\+xml" href="(.+?)"/)
        if (actionApiMatchs) {
            let x = actionApiMatchs[1].replace('?action=rsd', '');
            // if the url starts with //, make it https://
            if (x.startsWith('//')) {
                x = 'https:' + x
            }
            return x
        }
        return null
    })();

    // We can also parse some other probably useful stuff from the main page that we already loaded...
    // Look for <title>HandWiki</title> in the responseText
    const title = responseText.match(/<title>(.+?)<\/title>/)[1]
    // Also look for <meta name="description" content="Wiki Encyclopedia of Knowledge"/>
    const descriptionMatch = responseText.match(/<meta name="description" content="(.+?)"/);
    const description = descriptionMatch ? descriptionMatch[1] : undefined
    // Also look for <meta name="generator" content="MediaWiki 1.38.4"/>
    const generator = responseText.match(/<meta name="generator" content="(.+?)"/)[1]
    const mwVersion = generator.match(/MediaWiki (.+?)$/)[1]
    // language from "wgPageContentLanguage":"en"
    const languageMatch = responseText.match(/"wgPageContentLanguage":"(.+?)"/)
    const language = languageMatch ? languageMatch[1] : 'en'

    // Lookup P53 (wikibase metadata ID)
    if (simpleClaims.P53) {
        let wbmetadata = await metadatalookup(simpleClaims.P53)
        console.log(wbmetadata)
    }

    // Figure out label and alias changes
    let probablyGoodLabels = []
    if (title) {
        probablyGoodLabels.push(title)
    }

    if (language === 'en') {

        // Figure out what we have
        probablyGoodLabels.push(domain)
        // Remove "Main Page - " from any of the starts of the probablyGoodLabels
        probablyGoodLabels = probablyGoodLabels.map(label => label.replace('Main Page - ', ''))
        // Remove any that still inclyude Main Page
        probablyGoodLabels = probablyGoodLabels.filter(label => !label.includes('Main Page'))
        // And make it unique and remove any empty strings
        probablyGoodLabels = [...new Set(probablyGoodLabels)].filter(label => label !== '')

        // Figure out the current state
        let allEnLabelsAndAliases = []
        let enLabelIsDomain = false
        if (entity.labels.en) {
            allEnLabelsAndAliases.push(entity.labels.en.value)
            if (entity.labels.en.value === domain) {
                enLabelIsDomain = true
            }
        }
        if (entity.aliases.en) {
            entity.aliases.en.forEach(alias => {
                allEnLabelsAndAliases.push(alias.value)
            });
        }

        // If one of the aliases starts with "Main Page - ", then remove it
        // This is a temporary fix, after I added some bad titles
        allEnLabelsAndAliases.forEach(alias => {
            if (alias.startsWith('Main Page - ')) {
                world.queueWork.aliasRemove(queues.one, { id: wiki.item, language: 'en', value: alias }, { summary: `Remove en alias "Main Page - " as its a bad alias` })
            }
        });

        // Find what is missing
        let missingLabels = probablyGoodLabels.filter(label => !allEnLabelsAndAliases.includes(label))
        // if there are missing labels
        if (missingLabels.length > 0) {
            // if the label is already the domain, then remove it from entity.labels.en, and add it to the missingLabels
            // This effectively swaps the domain for a better label that we now might have (if we are doing an edit)
            if (enLabelIsDomain) {
                entity.labels.en = undefined
                missingLabels.push(domain)
            }
            // if there is no label, set the first thing there
            if (!entity.labels.en) {
                // TODO write tests for figuring out labels and aliases before running this, ALSO this probably needs to happen in a single edit due to async
                // world.queueWork.labelSet(queues.one, { id: wiki.item, language: 'en', value: missingLabels[0] }, { summary: `Add en label from known infomation` })
                // and remove it from the list
                missingLabels.shift()
            }
            // if there are still missing labels, add them as aliases
            if (missingLabels.length > 0) {
                missingLabels.forEach(missingLabel => {
                    // TODO write tests for figuring out labels and aliases before running this, ALSO this probably needs to happen in a single edit due to async
                    // world.queueWork.aliasAdd(queues.one, { id: wiki.item, language: 'en', value: missingLabel }, { summary: `Add en alias from known infomation` })
                });
            }
        }

        // If there is no en description, then set it
        if (description && !entity.descriptions.en) {
            world.queueWork.descriptionSet(queues.one, { id: wiki.item, language: 'en', value: description }, { summary: `Add en description from Main Page HTML` })
        }
    }

    // If the item does not have a P13 claim, then ensure P13 -> Q54, as the site appears online
    // Note this doesnt change the claim, as redirects are followed, and might result in a site appearing online when it is not, such as wikibase-registry
    if (!simpleClaims.P13 ) {
        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P13', value: 'Q54' }, { summary: `Add [[Property:P13]] claim for [[Item:Q54]] based on the fact it respondes with a 200 of MediaWiki` })
    }

    // If the domain ends in .wikibase.cloud
    if (domain.endsWith('.wikibase.cloud') || reverseDNS.includes(REVERSE_CLOUD)) {
        let hostBy = ''
        if (domain.endsWith('.wikibase.cloud')) {
            hostBy = ' (from the domain)'
        } else {
            hostBy = ' (from reverse DNS)'
        }

        // Then ensure P2 (Host) -> Q8 (Wikibase.cloud) on the world item
        if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q8') {
            world.queueWork.claimEnsure(queue, { id: wiki.item, property: 'P2', value: 'Q8' }, { summary: `Add [[Property:P2]] claim for [[Item:Q8]] based on [[Property:P1]] of ${wiki.site}` + hostBy })
        }
        // We also know a variaty of URLs, as they are determined by the platform
        // P7 query service UI
        // P8 query service SPARQL endpoint
        // P49 Main Page URL
        // Techncially the UI rediretcs to includes a '/' so allow that
        let protocolledDomain = 'https://' + domain
        if (!simpleClaims.P7 || (simpleClaims.P7.length <= 1 && !simpleClaims.P7.includes(protocolledDomain + '/query') && !simpleClaims.P7.includes(protocolledDomain + '/query/'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P7', value: protocolledDomain + '/query' }, { summary: `Add [[Property:P7]] claim for ${protocolledDomain}/query as it is known for [[Item:Q8]] hosted wikis` })
        }
        if (!simpleClaims.P8 || (simpleClaims.P8.length <= 1 && simpleClaims.P8[0] !== protocolledDomain + '/query/sparql')) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P8', value: protocolledDomain + '/query/sparql' }, { summary: `Add [[Property:P8]] claim for ${protocolledDomain}/query/sparql as it is known for [[Item:Q8]] hosted wikis` })
        }
        if (!simpleClaims.P49 || (simpleClaims.P49.length <= 1 && simpleClaims.P49[0] !== protocolledDomain + '/wiki/Main_Page')) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P49', value: protocolledDomain + '/wiki/Main_Page' }, { summary: `Add [[Property:P49]] claim for ${protocolledDomain}/wiki/Main_Page as it is known for [[Item:Q8]] hosted wikis` })
        }

        // We can also add P37 (wiki tool used), for a bunch of things...
        // Q285 is the query service
        // Q287 is cradle
        // Q286 is quickstatements
        if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q285'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q285', qualifiers: {'P7': protocolledDomain + '/query', 'P8': protocolledDomain + '/query/sparql'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q285]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q287'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q287', qualifiers: {'P1': protocolledDomain + '/tools/cradle'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q287]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q286'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q286', qualifiers: {'P1': protocolledDomain + '/tools/quickstatements'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q286]] based on the fact it is a wikibase.cloud wiki` })
        }

        // All wikibase.cloud sites also support items and properties...
        // SO P12 should have a statement for Q51 and Q52
        if (!simpleClaims.P12 || (!simpleClaims.P12.includes('Q51'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P12', value: 'Q51' }, { summary: `Add [[Property:P12]] claim for [[Item:Q51]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!simpleClaims.P12 || (!simpleClaims.P12.includes('Q52'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P12', value: 'Q52' }, { summary: `Add [[Property:P12]] claim for [[Item:Q52]] based on the fact it is a wikibase.cloud wiki` })
        }
    } else {
        // console.log(domain + " -> " + reverseDNS)
    }

    // If the domain ends in wikibase.wiki
    if (wiki.site.endsWith('.wikibase.wiki')) {
        // Then ensure P2 (Host) -> Q7 (The Wikibase Consultancy)
        if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q7') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q7' }, { summary: `Add [[Property:P2]] claim for [[Item:Q7]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    // If the domain ends in miraheze.org, then it is hosted by Q118
    if (wiki.site.endsWith('.miraheze.org')) {
        if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q118') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q118' }, { summary: `Add [[Property:P2]] claim for [[Item:Q118]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    // ends with .wmflabs.org, hosted by https://wikibase.world/wiki/Item:Q6
    if (wiki.site.endsWith('.wmflabs.org')) {
        if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q6') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q6' }, { summary: `Add [[Property:P2]] claim for [[Item:Q6]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    // Try to figure out the inception date (P5), based on when the first edit was made
    // We can find this by using the API, such as https://furry.wikibase.cloud/w/api.php?action=query&list=logevents&ledir=newer&lelimit=1&format=json
    // And getting .query.logevents[0].timestamp
    if (actionApi) {
        queues.many.add(async () => {
            try{
                const logApiUrl = actionApi + '?action=query&list=logevents&ledir=newer&lelimit=1&format=json'
                const actionApiResponse = await fetchc(logApiUrl, { headers: HEADERS }).then(res => res.json())
                if (actionApiResponse.query.logevents.length != 1) {
                    console.log(`❌ Failed to get the inception date for ${wiki.site}`)
                }
                // Timestamp is like 2020-02-11T18:11:02Z
                const inceptionDate = actionApiResponse.query.logevents[0].timestamp.split('T')[0]
                // if there is no P5 claim, add one
                if (!simpleClaims.P5) {
                    const today = new Date().toISOString().split('T')[0]
                    world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P5', value: inceptionDate, references: { P21: logApiUrl, P22: today } }, { summary: `Add [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` })
                }
                // if there is a P5 claim, and it has the same value, and no reference, add the reference
                // TODO consider adding an additions reference, if it aleady has one, but not the logApiUrl
                if (simpleClaims.P5 && simpleClaims.P5.length <= 1 && simpleClaims.P5[0].split('T')[0] === inceptionDate && entity.claims.P5[0].references === undefined) {
                    const today = new Date().toISOString().split('T')[0]
                    const guid = entity.claims.P5[0].id
                    world.queueWork.referenceSet(queues.one, { guid, snaks: { P21: logApiUrl, P22: today } }, { summary: `Add references to [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` })
                }
            } catch (e) {
                console.log(`❌ Failed to get the inception date for ${wiki.site}`)
            }
        });
    }

    // We can try to normalize the URL if it is a Main_Page
    if (wiki.site.includes('/wiki/Main_Page')) {
        queues.many.add(async () => {
            const shorterUrl = wiki.site.replace(/\/wiki\/Main_Page$/, '');
            try {
                const newResponse = await fetchc(shorterUrl, { headers: HEADERS });
                if (response.url === newResponse.url) {
                    // Skip if there is more than 1 P1 claim
                    if (simpleClaims.P1.length > 1) {
                        console.log(`❌ The item ${wiki.item} has more than 1 P1 claim`)
                        return
                    }
                    world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P1', oldValue: wiki.site, newValue: shorterUrl }, { summary: 'Shorten Main_Page URL for consistency in [[Property:P1]] usage' })
                } else {
                    console.log(`❌ The URL ${wiki.site} can not be shortened to ${shorterUrl}, as they go to different pages ${response.url} and ${newResponse.url}`);
                }
            } catch (e) {
                console.log(`❌ Failed to try and normalize the URL ${wiki.site}`);
            }
        });
    }
});
