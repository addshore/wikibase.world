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
            const jobName = `claimRemove: ${data.id}/${data.property || data.claim}`;
            queue.add(async () => {
                const target = data.claim ? data.claim : data.value
                const logText = `🖊️ Removing claim for ${data.id} (${target}) ${data.property ? 'property ' + data.property : ''}: ${requestConfig.summary}`
                console.log(logText)
                // If a specific claim GUID is provided, prefer removing by GUID for precision
                if (data.claim) {
                    // wikibase-edit expects the full claim ID (e.g., Q123$UUID) under the `guid` key
                    await retryIn60If429(() => worldEdit.claim.remove({ guid: data.claim }, requestConfig), logText)
                } else {
                    await retryIn60If429(() => worldEdit.claim.remove(data, requestConfig), logText)
                }
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
        // Work with the raw claims so we can remove specific GUIDs rather than bluntly removing by value
        const rawClaims = entities[data.id].claims && entities[data.id].claims[data.property] ? entities[data.id].claims[data.property] : []

        // Helper to extract a comparable value from a claim mainsnak
        const claimValueFrom = (claim) => {
            try {
                const dv = claim.mainsnak && claim.mainsnak.datavalue
                if (!dv) return null
                if (dv.type === 'wikibase-entityid') return dv.value && dv.value.id
                return dv.value
            } catch (e) {
                return null
            }
        }

        const formatValue = (v) => {
            if (v === null || v === undefined) return 'null'
            if (typeof v === 'object') {
                // Quantity objects have amount and unit
                if ('amount' in v) return `${v.amount}`
                // datavalue objects or other objects - stringify minimally
                try { return JSON.stringify(v) } catch (e) { return String(v) }
            }
            return String(v)
        }

        const fullClaims = rawClaims.map(c => ({ guid: c.id, value: claimValueFrom(c) }))

        // If there's no existing claim for this property, create it
        if (fullClaims.length === 0) {
            console.log(`🖊️ claimEnsure create: ${data.id} ${data.property} → ${formatValue(data.value)} : ${requestConfig.summary}`)
            world.queueWork.claimCreate(queue, data, requestConfig)
            return
        }

        const desired = data.value
        const desiredClaims = fullClaims.filter(c => {
            // Compare primitive and simple objects (e.g. quantity.amount vs number)
            try {
                if (typeof c.value === 'object' && c.value !== null && 'amount' in c.value) {
                    // quantity object - compare numeric values
                    const a = parseInt(String(c.value.amount).replace('+',''), 10)
                    const b = typeof desired === 'object' && desired !== null && 'amount' in desired
                        ? parseInt(String(desired.amount).replace('+',''), 10)
                        : parseInt(String(desired), 10)
                    return a === b
                }
                return c.value === desired
            } catch (e) {
                return false
            }
        })

        // If we already have the desired value present in one or more claims
        if (desiredClaims.length >= 1) {
            // Keep one desired claim, remove any other claims (including duplicates)
            const keepGuid = desiredClaims[0].guid
            let removed = 0
            for (const c of fullClaims) {
                if (c.guid !== keepGuid) {
                    removed++
                    console.log(`🖊️ claimEnsure remove duplicate: ${data.id} ${data.property} (${c.guid}) (keeping ${keepGuid})`)
                    world.queueWork.claimRemove(queue, { id: data.id, claim: c.guid }, requestConfig)
                }
            }
            if (removed > 0) console.log(`🖊️ claimEnsure kept existing ${data.id} ${data.property} → ${formatValue(desired)} (removed ${removed} duplicates)`)
            return
        }

        // No existing desired value present
        if (fullClaims.length === 1) {
            // Replace single existing claim with our value
            console.log(`🖊️ claimEnsure replace: ${data.id} ${data.property} ${formatValue(fullClaims[0].value)} → ${formatValue(desired)} : ${requestConfig.summary}`)
            world.queueWork.claimUpdate(queue, { id: data.id, property: data.property, oldValue: fullClaims[0].value, newValue: desired }, requestConfig)
            return
        }

        // Multiple existing claims and none match desired: remove them all by GUID then create the canonical claim
        console.log(`🖊️ claimEnsure normalize: ${data.id} ${data.property} removing ${fullClaims.length} claims then creating ${formatValue(desired)}`)
        for (const c of fullClaims) {
            world.queueWork.claimRemove(queue, { id: data.id, claim: c.guid }, requestConfig)
        }
        world.queueWork.claimCreate(queue, data, requestConfig)
    }, { jobName });
}

export { world }