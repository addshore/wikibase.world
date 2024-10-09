import { WBK } from 'wikibase-sdk'
import { simplifyClaims } from 'wikibase-sdk'
import dotenv from 'dotenv'
import WBEdit from 'wikibase-edit'
import { simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'
import PQueue from 'p-queue';
import EventEmitter from 'node:events';
import { fetchuc, fetchc } from './src/fetch.js'

// Load .env file
dotenv.config()

// Setup config and constants
const WORLD_INSTANCE = 'https://wikibase.world'
const WORLD_USERNAME = process.env.WORLD_USERNAME
const WORLD_PASSWORD = process.env.WORLD_PASSWORD
const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };
const CONCURRENCY = 10;

// Setup services
const world = WBK({
    instance: WORLD_INSTANCE,
    sparqlEndpoint: WORLD_INSTANCE + '/query/sparql'
})
const worldEdit = WBEdit({
    instance: WORLD_INSTANCE,
    credentials: {
        username: WORLD_USERNAME,
        password: WORLD_PASSWORD
    },
    bot: true,
})
const queue = new PQueue({concurrency: CONCURRENCY});
const ee = new EventEmitter();

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

// Queue an initial lookup of live wikibase.world wikis
queue.add(async () => {
    const sparql = `
    PREFIX wdt: <https://wikibase.world/prop/direct/>
    PREFIX wd: <https://wikibase.world/entity/>
    SELECT ?item ?site WHERE {
      ?item wdt:P3 wd:Q10.  
      ?item wdt:P1 ?site.
    }
    `
    const url = world.sparqlQuery(sparql)
    const raw = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
    let results = minimizeSimplifiedSparqlResults(simplifySparqlResults((raw)))
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
    queue.add(async () => {
        // const itemId = result.item
        const url = result.site
        try{
            const response = await fetchc(url, { headers: HEADERS })
            if (response.status !== 200) {
                console.log(`❌ The URL ${url} is not currently a 200`)
                return
            }
            ee.emit('world.wikis.200', { wiki: result, response: response })
        } catch (e) {
            console.log(`❌ The URL ${url} is not currently a 200`)
            return
        }
    });
});

ee.on('world.wikis.200', async ({ wiki, response }) => {
    const url = world.getEntities({ids: [ wiki.item ]})
    const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
    const entity = entities[wiki.item]
    const simpleClaims = simplifyClaims(entity.claims)
    const responseText = await response.text()
    const urlIsMediaWiki = responseText.includes('content="MediaWiki')
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

    if (!urlIsMediaWiki) {
        console.log(`❌ The URL ${wiki.site} is not a MediaWiki, aborting for now...`)
        return
    }

    // If the item does not have a P13 claim, then ensure P13 -> Q54, as the site appears online
    // Note this doesnt change the claim, as redirects are followed, and might result in a site appearing online when it is not, such as wikibase-registry
    if (!simpleClaims.P13 ) {
        ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P13', value: 'Q54'}, requestConfig: { summary: `Add [[Property:P13]] claim for [[Item:Q54]] based on the fact it respondes with a 200 of MediaWiki` } })
    }

    // If the domain ends in .wikibase.cloud
    if (wiki.site.endsWith('.wikibase.cloud')) {
        // Then ensure P2 (Host) -> Q8 (Wikibase.cloud) on the world item
        queue.add(async () => {
            if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q8') {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P2', value: 'Q8'}, requestConfig: { summary: `Add [[Property:P2]] claim for [[Item:Q8]] based on [[Property:P1]] of ${wiki.site}` } })
            }
        });
        // We also know a variaty of URLs, as they are determined by the platform
        // P7 query service UI
        // P8 query service SPARQL endpoint
        // P49 Main Page URL
        queue.add(async () => {
            // Techncially the UI rediretcs to includes a '/' so allow that
            if (!simpleClaims.P7 || (simpleClaims.P7.length <= 1 && !simpleClaims.P7.includes(wiki.site + '/query') && !simpleClaims.P7.includes(wiki.site + '/query/'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P7', value: wiki.site + '/query'}, requestConfig: { summary: `Add [[Property:P7]] claim for ${wiki.site}/query as it is known for [[Item:Q8]] hosted wikis` } })
            }
        });
        queue.add(async () => {
            if (!simpleClaims.P8 || (simpleClaims.P8.length <= 1 && simpleClaims.P8[0] !== wiki.site + '/query/sparql')) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P8', value: wiki.site + '/query/sparql'}, requestConfig: { summary: `Add [[Property:P8]] claim for ${wiki.site}/query/sparql as it is known for [[Item:Q8]] hosted wikis` } })
            }
        });
        queue.add(async () => {
            if (!simpleClaims.P49 || (simpleClaims.P49.length <= 1 && simpleClaims.P49[0] !== wiki.site + '/wiki/Main_Page')) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P49', value: wiki.site + '/wiki/Main_Page'}, requestConfig: { summary: `Add [[Property:P49]] claim for ${wiki.site}/wiki/Main_Page as it is known for [[Item:Q8]] hosted wikis` } })
            }
        });

        // We can also add P37 (wiki tool used), for a bunch of things...
        // Q285 is the query service
        // Q287 is cradle
        // Q286 is quickstatements
        queue.add(async () => {
            if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q285'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P37', value: 'Q285', qualifiers: {'P7': wiki.site + '/query', 'P8': wiki.site + '/query/sparql'}}, requestConfig: { summary: `Add [[Property:P37]] claim for [[Item:Q285]] based on the fact it is a wikibase.cloud wiki` } })
            }
        });
        queue.add(async () => {
            if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q287'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P37', value: 'Q287', qualifiers: {'P1': wiki.site + '/tools/cradle'}}, requestConfig: { summary: `Add [[Property:P37]] claim for [[Item:Q287]] based on the fact it is a wikibase.cloud wiki` } })
            }
        });
        queue.add(async () => {
            if (!simpleClaims.P37 || (!simpleClaims.P37.includes('Q286'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P37', value: 'Q286', qualifiers: {'P1': wiki.site + '/tools/quickstatements'}}, requestConfig: { summary: `Add [[Property:P37]] claim for [[Item:Q286]] based on the fact it is a wikibase.cloud wiki` } })
            }
        });

        // All wikibase.cloud sites also support items and properties...
        // SO P12 should have a statement for Q51 and Q52
        queue.add(async () => {
            if (!simpleClaims.P12 || (!simpleClaims.P12.includes('Q51'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P12', value: 'Q51'}, requestConfig: { summary: `Add [[Property:P12]] claim for [[Item:Q51]] based on the fact it is a wikibase.cloud wiki` } })
            }
        });
        queue.add(async () => {
            if (!simpleClaims.P12 || (!simpleClaims.P12.includes('Q52'))) {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P12', value: 'Q52'}, requestConfig: { summary: `Add [[Property:P12]] claim for [[Item:Q52]] based on the fact it is a wikibase.cloud wiki` } })
            }
        });
    }

    // If the domain ends in wikibase.wiki
    if (wiki.site.endsWith('.wikibase.wiki')) {
        // Then ensure P2 (Host) -> Q7 (The Wikibase Consultancy)
        queue.add(async () => {
            if (!simpleClaims.P2 || simpleClaims.P2[0] !== 'Q7') {
                ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P2', value: 'Q7'}, requestConfig: { summary: `Add [[Property:P2]] claim for [[Item:Q7]] based on [[Property:P1]] of ${wiki.site}` } })
            }
        });
    }

    // Try to figure out the inception date (P5), based on when the first edit was made
    // We can find this by using the API, such as https://furry.wikibase.cloud/w/api.php?action=query&list=logevents&ledir=newer&lelimit=1&format=json
    // And getting .query.logevents[0].timestamp
    if (actionApi) {
        queue.add(async () => {
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
                    ee.emit('world.editRequest.claimEnsure', { data: {id: wiki.item, property: 'P5', value: inceptionDate, references: { P21: logApiUrl, P22: today }}, requestConfig: { summary: `Add [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` } })
                }
                // if there is a P5 claim, and it has the same value, and no reference, add the reference
                // TODO consider adding an additions reference, if it aleady has one, but not the logApiUrl
                if (simpleClaims.P5 && simpleClaims.P5.length <= 1 && simpleClaims.P5[0].split('T')[0] === inceptionDate && entity.claims.P5[0].references === undefined) {
                    const today = new Date().toISOString().split('T')[0]
                    const guid = entity.claims.P5[0].id
                    ee.emit('world.editRequest.referenceSet', { data: {guid, snaks: { P21: logApiUrl, P22: today }}, requestConfig: { summary: `Add references to [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` } })
                }
            } catch (e) {
                console.log(`❌ Failed to get the inception date for ${wiki.site}`)
            }
        });
    }

    // We can try to normalize the URL if it is a Main_Page
    if (wiki.site.includes('/wiki/Main_Page')) {
        queue.add(async () => {
            const shorterUrl = wiki.site.replace(/\/wiki\/Main_Page$/, '');
            try {
                const newResponse = await fetchc(shorterUrl, { headers: HEADERS });
                if (response.url === newResponse.url) {
                    // Skip if there is more than 1 P1 claim
                    if (simpleClaims.P1.length > 1) {
                        console.log(`❌ The item ${wiki.item} has more than 1 P1 claim`)
                        return
                    }
                    ee.emit('world.editRequest.claimUpdate', { data: {id: wiki.item, property: 'P1', oldValue: wiki.site, newValue: shorterUrl}, requestConfig: { summary: 'Shorten Main_Page URL for consistency in [[Property:P1]] usage' } })
                } else {
                    console.log(`❌ The URL ${wiki.site} can not be shortened to ${shorterUrl}, as they go to different pages ${response.url} and ${newResponse.url}`);
                }
            } catch (e) {
                console.log(`❌ Failed to try and normalize the URL ${wiki.site}`);
            }
        });
    }
});

ee.on('world.editRequest.claimUpdate', ({ data, requestConfig }) => {
    queue.add(async () => {
        console.log(`🖊️ Updating claim for ${data.id} with ${data.property} from ${data.oldValue} to ${data.newValue}: ${requestConfig.summary}`)
        worldEdit.claim.update(data, requestConfig)
    });
});

ee.on('world.editRequest.claimEnsure', ({ data, requestConfig }) => {
    queue.add(async () => {
        // Get the entity from data.id
        const url = world.getEntities({ids: [ data.id ]})
        const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
        const simpleClaims = simplifyClaims(entities[data.id].claims)
        // TODO handle multiple claims of the property?
        // TODO run away from qualifiers for now?
        if (simpleClaims[data.property] && simpleClaims[data.property].length > 1) {
            console.log(`❌ The claim for ${data.id} with ${data.property} has more than 1 value on ${data.id}`)
            return
        }

        ee.emit('world.editRequest.claimCreate', { data: data, requestConfig: requestConfig })
    });
});

ee.on('world.editRequest.claimCreate', ({ data, requestConfig }) => {
    queue.add(async () => {
        console.log(`🖊️ Creating claim for ${data.id} with ${data.property} to ${data.value}: ${requestConfig.summary}`)
        worldEdit.claim.create(data, requestConfig)
    });
});

ee.on('world.editRequest.referenceSet', ({ data, requestConfig }) => {
    queue.add(async () => {
        console.log(`🖊️ Adding reference to claim ${data.guid}: ${requestConfig.summary}`)
        worldEdit.reference.set(data, requestConfig)
    });
});