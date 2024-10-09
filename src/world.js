import WBEdit from 'wikibase-edit'
import { WBK } from 'wikibase-sdk'
import { simplifyClaims } from 'wikibase-sdk'
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
    bot: true,
})

const world = {
    sdk: worldSDK,
    edit: worldEdit,
    queueWork: {
        claimUpdate: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Updating claim for ${data.id} with ${data.property} from ${data.oldValue} to ${data.newValue}: ${requestConfig.summary}`)
                worldEdit.claim.update(data, requestConfig)
            });
        },
        claimCreate: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Creating claim for ${data.id} with ${data.property} as ${data.value}: ${requestConfig.summary}`)
                worldEdit.claim.create(data, requestConfig)
            });
        },
        referenceSet: async (queue, data, requestConfig) => {
            queue.add(async () => {
                console.log(`🖊️ Setting reference for ${data.guid}: ${requestConfig.summary}`)
                worldEdit.reference.set(data, requestConfig)
            });
        },
    }
}

world.queueWork.claimEnsure = async (queue, data, requestConfig) => {
    queue.add(async () => {
        // Get the entity from data.id
        const url = world.sdk.getEntities({ids: [ data.id ]})
        const { entities } = await fetchuc(url, { headers: HEADERS }).then(res => res.json())
        const simpleClaims = simplifyClaims(entities[data.id].claims)
        // TODO handle multiple claims of the property?
        // TODO run away from qualifiers for now?
        if (simpleClaims[data.property] && simpleClaims[data.property].length > 1) {
            console.log(`❌ The claim for ${data.id} with ${data.property} has more than 1 value on ${data.id}`)
            return
        }

        world.queueWork.claimCreate(queue, data, requestConfig)
    });
}

export { world }