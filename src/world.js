import WBEdit from 'wikibase-edit'
import { WBK } from 'wikibase-sdk'
import { simplifyClaims } from 'wikibase-sdk'
import { simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'
import { fetchuc, fetchc } from './../src/fetch.js';
import { HEADERS } from './../src/general.js';
import dotenv from 'dotenv'

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

const world = {
    sdk: worldSDK,
    edit: worldEdit,
    sparql: {},
    queueWork: {
        itemCreate: async (queue, data, requestConfig) => {
            data.type = 'item'
            queue.add(async () => {
                console.log(`🖊️ Creating item: ${requestConfig.summary}`)
                await worldEdit.entity.create(data, requestConfig)
            });
        },
        labelSet: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Setting label for ${data.id} in ${data.language} to ${data.value}: ${requestConfig.summary}`)
                await worldEdit.label.set(data, requestConfig)
            });
        },
        descriptionSet: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Setting description for ${data.id} in ${data.language} to ${data.value}: ${requestConfig.summary}`)
                await worldEdit.description.set(data, requestConfig)
            });
        },
        aliasAdd: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Adding alias for ${data.id} in ${data.language} as ${data.value}: ${requestConfig.summary}`)
                await worldEdit.alias.add(data, requestConfig)
            });
        },
        aliasRemove: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Removing alias for ${data.id} in ${data.language} as ${data.value}: ${requestConfig.summary}`)
                await worldEdit.alias.remove(data, requestConfig)
            });
        },
        claimUpdate: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Updating claim for ${data.id} with ${data.property} from ${data.oldValue} to ${data.newValue}: ${requestConfig.summary}`)
                await worldEdit.claim.update(data, requestConfig)
            });
        },
        claimCreate: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Creating claim for ${data.id} with ${data.property} as ${data.value}: ${requestConfig.summary}`)
                await worldEdit.claim.create(data, requestConfig)
            });
        },
        claimRemove: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Removing claim for ${data.id} with ${data.property} as ${data.value}: ${requestConfig.summary}`)
                await worldEdit.claim.remove(data, requestConfig)
            });
        },
        referenceSet: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Setting reference for ${data.guid}: ${requestConfig.summary}`)
                await worldEdit.reference.set(data, requestConfig)
            });
        },
    }
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
    }
    `
    const url = world.sdk.sparqlQuery(sparqlQuery)
    const raw = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
    return minimizeSimplifiedSparqlResults(simplifySparqlResults(raw))
}

world.queueWork.claimEnsure = async (queue, data, requestConfig) => {
    queue.add(async () => {
        // Get the entity from data.id
        const url = world.sdk.getEntities({ids: [ data.id ]})
        const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
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
    });
}

export { world }