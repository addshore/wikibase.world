import { WBK } from 'wikibase-sdk'
import { simplifyClaims } from 'wikibase-sdk'
import dotenv from 'dotenv'
import WBEdit from 'wikibase-edit'
import { simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'
import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache';
import PQueue from 'p-queue';
import EventEmitter from 'node:events';
import fetch from 'node-fetch';

// Load .env file
dotenv.config()

// Setup config and constants
const WORLD_INSTANCE = 'https://wikibase.world'
const WORLD_USERNAME = process.env.WORLD_USERNAME
const WORLD_PASSWORD = process.env.WORLD_PASSWORD
const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };
const CONCURRENCY = 10;

// Setup services
const fetchCachedInternal = NodeFetchCache.create({
    cache: new FileSystemCache({
        cacheDirectory: './.cache',
        ttl: 60*30,
    }),
});
const fetchuc = async (url, options) => {
    console.log(`🚀 Fetching ${url} (uncached)`)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}
const fetchc = async (url, options) => {
    console.log(`🚀 Fetching ${url} (caching)`)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        return await fetchCachedInternal(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}
const world = WBK({
    instance: WORLD_INSTANCE,
    sparqlEndpoint: WORLD_INSTANCE + '/query/sparql'
})
const worldEdit = WBEdit({
    instance: WORLD_INSTANCE,
    credentials: {
        username: WORLD_USERNAME,
        password: WORLD_PASSWORD
    }
})
const queue = new PQueue({concurrency: CONCURRENCY});
const ee = new EventEmitter();

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
            console.log(`✅ The URL ${url} is currently a 200`)
            ee.emit('world.wikis.200', { wiki: result, response: response })
        } catch (e) {
            console.log(`❌ The URL ${url} is not currently a 200`)
            return
        }
    });
});

ee.on('world.wikis.200', ({ wiki, response }) => {
    // We can try to normalize the URL if it is a Main_Page
    if (wiki.site.includes('/wiki/Main_Page')) {
        queue.add(async () => {
            const shorterUrl = wiki.site.replace(/\/wiki\/Main_Page$/, '');
            try {
                const newResponse = await fetchc(shorterUrl, { headers: HEADERS });
                if (response.url === newResponse.url) {
                    console.log(`✅ The URL ${wiki.site} can be shortened to ${shorterUrl}, as they both go to ${response.url}`);

                    // Fetch the item from the world wikibase
                    const url = world.getEntities({ids: [ wiki.item ]})
                    const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
                    const simpleClaims = simplifyClaims(entities[wiki.item].claims)
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
        console.log(`🖊️ Updating claim for ${data.id} with ${data.property} from ${data.oldValue} to ${data.newValue}`)
        worldEdit.claim.update(data, requestConfig)
    });
});