import WBEdit from 'wikibase-edit'
import { WBK } from 'wikibase-sdk'
import { simplifyClaims } from 'wikibase-sdk'
import { simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'
import { fetchuc } from './../src/fetch.js';
import { HEADERS } from './../src/general.js';
import dotenv from 'dotenv'
import process from 'process';

dotenv.config()

// Require the environment variables
if (!process.env.WORLD_USERNAME || !process.env.WORLD_PASSWORD) {
    throw new Error('Missing WORLD_USERNAME or WORLD_PASSWORD')
}

// Setup config and constants
const WORLD_INSTANCE = 'https://wikibase.world'
const WORLD_USERNAME = process.env.WORLD_USERNAME
const WORLD_PASSWORD = process.env.WORLD_PASSWORD

// Setup services
const worldSDK = WBK({
    instance: WORLD_INSTANCE,
    sparqlEndpoint: WORLD_INSTANCE + '/query/sparql'
})
const worldEdit = WBEdit({
    instance: WORLD_INSTANCE,
    credentials: {
        username: WORLD_USERNAME,
        password: WORLD_PASSWORD
    },
    maxlag: 30,
    bot: true,
})

// Function that retries the callback in 10 seconds if we catch any error that says "429 Too Many Requests"
const retryIn60If429 = async (callback, name) => {
    try {
        return await callback()
    } catch (error) {
        if (error.message.includes('429 Too Many Requests')) {
            console.log(`↩️⏸️ 429 Too Many Requests in world callback, retrying in 10 seconds for ` + name)
            await new Promise(resolve => setTimeout(resolve, 10000))
            console.log('↩️ Retrying now for ' + name)
            return await retryIn60If429(callback)
        } else if (error.name === 'AbortError') {
            console.error('Fetch aborted for ' + name)
        } else {
            throw error
        }
    }
}

const world = {
    sdk: worldSDK,
    edit: worldEdit,
    sparql: {},
    queueWork: {
        itemCreate: async (queue, data, requestConfig) => {
            data.type = 'item'
            const jobName = `itemCreate: ${requestConfig.summary}`;
            queue.add(async () => {
                const logText = `🖊️ Creating item: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.entity.create(data, requestConfig), logText)
            }, { jobName });
        },
        labelSet: async (queue, data, requestConfig) => {
            const jobName = `labelSet: ${data.id}`;
            queue.add(async () => {
                const logText = `🖊️ Setting label for ${data.id} in ${data.language} to ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.label.set(data, requestConfig), logText)
            }, { jobName });
        },
        descriptionSet: async (queue, data, requestConfig) => {
            const jobName = `descriptionSet: ${data.id}`;
            queue.add(async () => {
                if (data.value.length > 250) {
                    console.warn(`⚠️ Description for ${data.id} in ${data.language} is too long (${data.value.length} characters): ${requestConfig.summary}`)
                    return
                }
                const logText = `🖊️ Setting description for ${data.id} in ${data.language} to ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.description.set(data, requestConfig), logText)
            }, { jobName });
        },
        aliasAdd: async (queue, data, requestConfig) => {
            const jobName = `aliasAdd: ${data.id}`;
            queue.add(async () => {
                const logText = `🖊️ Adding alias for ${data.id} in ${data.language} as ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.alias.add(data, requestConfig), logText)
            }, { jobName });
        },
        aliasRemove: async (queue, data, requestConfig) => {
            const jobName = `aliasRemove: ${data.id}`;
            queue.add(async () => {
                const logText = `🖊️ Removing alias for ${data.id} in ${data.language} as ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.alias.remove(data, requestConfig), logText)
            }, { jobName });
        },
        claimUpdate: async (queue, data, requestConfig) => {
            const jobName = `claimUpdate: ${data.id}/${data.property}`;
            queue.add(async () => {
                const logText = `🖊️ Updating claim for ${data.id} with ${data.property} from ${data.oldValue} to ${data.newValue}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.claim.update(data, requestConfig), logText)
            }, { jobName });
        },
        claimCreate: async (queue, data, requestConfig) => {
            const jobName = `claimCreate: ${data.id}/${data.property}`;
            queue.add(async () => {
                const logText = `🖊️ Creating claim for ${data.id} with ${data.property} as ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.claim.create(data, requestConfig), logText)
            }, { jobName });
        },
        claimRemove: async (queue, data, requestConfig) => {
            const jobName = `claimRemove: ${data.id}/${data.property}`;
            queue.add(async () => {
                const logText = `🖊️ Removing claim for ${data.id} with ${data.property} as ${data.value}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.claim.remove(data, requestConfig), logText)
            }, { jobName });
        },
        referenceSet: async (queue, data, requestConfig) => {
            const jobName = `referenceSet: ${data.guid}`;
            queue.add(async () => {
                const logText = `🖊️ Setting reference for ${data.guid}: ${requestConfig.summary}`
                console.log(logText)
                await retryIn60If429(() => worldEdit.reference.set(data, requestConfig), logText)
            }, { jobName });
        },
    }
}

/**
 * @returns {Array<{item: string, site: string}>}
 */
world.sparql.wikisAll = async () => {
    const sparqlQuery = `
    PREFIX wdt: <https://wikibase.world/prop/direct/>
    PREFIX wd: <https://wikibase.world/entity/>
    SELECT ?item ?site WHERE {
      ?item wdt:P3 wd:Q10.  
      ?item wdt:P1 ?site.
    }
    `
    const url = world.sdk.sparqlQuery(sparqlQuery)
    const response = await fetchuc(url, { headers: HEADERS })
    if (!response) {
        console.error('❌ Failed to fetch wikisAll from SPARQL')
        return []
    }
    const raw = await response.json()
    return minimizeSimplifiedSparqlResults(simplifySparqlResults(raw))
}

/**
 * @returns {Array<{item: string, site: string}>}
 */
world.sparql.wikis = async () => {
    const sparqlQuery = `
    PREFIX wdt: <https://wikibase.world/prop/direct/>
    PREFIX wd: <https://wikibase.world/entity/>
    SELECT ?item ?site WHERE {
      ?item wdt:P3 wd:Q10.  
      ?item wdt:P1 ?site.
      FILTER NOT EXISTS { ?item wdt:P13 wd:Q57 } # Ignore permanently offline instances
      FILTER NOT EXISTS { ?item wdt:P13 wd:Q72 } # Ignore indefinitely offline instances
    }
    `
    const url = world.sdk.sparqlQuery(sparqlQuery)
    const response = await fetchuc(url, { headers: HEADERS })
    if (!response) {
        console.error('❌ Failed to fetch wikis from SPARQL')
        return []
    }
    const raw = await response.json()
    return minimizeSimplifiedSparqlResults(simplifySparqlResults(raw))
}

/**
 * @returns {Array<{item: string, site: string}>}
 */
world.sparql.cloudWikis = async () => {
    const sparqlQuery = `
    PREFIX wdt: <https://wikibase.world/prop/direct/>
    PREFIX wd: <https://wikibase.world/entity/>
    SELECT ?item ?site WHERE {
      ?item wdt:P3 wd:Q10.  
      ?item wdt:P2 wd:Q8. # wikibase.cloud host
      ?item wdt:P1 ?site.
    }
    `
    const url = world.sdk.sparqlQuery(sparqlQuery)
    const response = await fetchuc(url, { headers: HEADERS })
    if (!response) {
        console.error('❌ Failed to fetch cloudWikis from SPARQL')
        return []
    }
    const raw = await response.json()
    return minimizeSimplifiedSparqlResults(simplifySparqlResults(raw))
}

world.queueWork.claimEnsure = async (queue, data, requestConfig) => {
    const jobName = `claimEnsure: ${data.id}/${data.property}`;
    queue.add(async () => {
        // Get the entity from data.id
        const url = world.sdk.getEntities({ids: [ data.id ]})
        const response = await fetchuc(url, { headers: HEADERS })
        if (!response) {
            console.error(`❌ Failed to fetch entities for ${data.id}: ${requestConfig.summary}`)
            return
        }
        const json = await response.json()
        if (!json || !json.entities) {
            console.error(`❌ Failed to parse entities for ${data.id}: ${requestConfig.summary}`)
            return
        }
        const { entities } = json
        const simpleClaims = simplifyClaims(entities[data.id].claims)
        // TODO we run away from qualifiers for now? :D
        let hasClaimWithValue = false
        simpleClaims[data.property]?.forEach(claim => {
            if (claim === data.value) {
                hasClaimWithValue = true
            }
        })
        if (hasClaimWithValue) {
            // console.log(`❌ The claim on ${data.id} for ${data.property} already has a value on ${simpleClaims[data.property]}: ` + requestConfig.summary)
            return
        }

        world.queueWork.claimCreate(queue, data, requestConfig)
    }, { jobName });
}

export { world }