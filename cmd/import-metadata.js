import { world } from './../src/world.js';
import { fetchuc, fetchc } from './../src/fetch.js';
import { queues, ee, HEADERS } from './../src/general.js';
import { checkOnlineAndWikibase } from './../src/site.js';
import dotenv from 'dotenv'
dotenv.config()

let graphqlURL = "https://wikibase-metadata.toolforge.org/graphql"
const generateQuery = (id) => {
    return `query MyQuery {
  wikibase(wikibaseId: ${id}) {
    id
    title
    urls {
      baseUrl
    }
  }
}`
}
// Remove this from the wikibase
// organization
// location {
//   country
//   region
// }
// Removed these urls from the query
// actionApi
// indexApi
// sparqlEndpointUrl
// sparqlUrl
// specialVersionUrl

const worldWikis = await world.sparql.wikis();
const worldWikiURLs = worldWikis.map(wiki => wiki.site)
const worldWikiItems = worldWikis.map(wiki => wiki.item)

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

// Start at 1, and go until the data is null
queues.many.add(async () => {
    let i = 1
    for (i = 1; i < 1000000; i++) {
        if (scriptFilter) {
            i = parseInt(scriptFilter)
        }
        // POST the query to the URL
        let postData  = {
            operationName: "MyQuery",
            query: generateQuery(i),
        }
        let headers = HEADERS
        // add json content type hearder
        headers['Content-Type'] = 'application/json'
        let options = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(postData),
        }
        const response = await fetchc(graphqlURL, options)
        const data = await response.json()
        if (!data || !data.data || !data.data.wikibase) {
            break
        }

        const wbURL = data.data.wikibase.urls.baseUrl
        if (!wbURL) {
            console.log(`❌ The wikibase ${wbURL} does not have a baseUrl for MediaWiki`)
            return
        }
        const domain = new URL(wbURL).hostname;

        // Make sure it doesnt already exist, so make sure the domain doesnt appear in any of the strings in worldWikiURLs
        if (!worldWikiURLs.some(wikiURL => wikiURL.includes(domain))) {
            ee.emit('metadata.wikis.load', { data: data.data.wikibase })
        } else {
            // if it does exist, check the metadata ID is set, OR set it
            // Find the item ID from worldWikis
            // but only using the domain
            let itemID = undefined
            for (let i = 0; i < worldWikiURLs.length; i++) {
                if (worldWikiURLs[i].includes(domain)) {
                    itemID = worldWikiItems[i]
                    break
                }
            }

            if (!itemID) {
                console.log(`❌ The wikibase ${wbURL} does not have an item in the world, even though we thought it did.. lol.`)
                return
            }
            world.queueWork.claimEnsure(queues.one, { id: itemID, property: 'P53', value: data.data.wikibase.id }, { summary: `Add [[Property:P53]] for a known https://wikibase-metadata.toolforge.org Wikibase` })
        }

        if (scriptFilter) {
            break
        }
    }
});

ee.on('metadata.wikis.load', async ({ data }) => {
    // url comes from baseUrl in urls
    const metadataId = data.id
    const url = data.urls.baseUrl
    const { result: checkResult, text: checkString } = await checkOnlineAndWikibase(url)
    if (!checkResult) {
        console.log(checkString)
        return
    }

    ee.emit('metadata.wikis.new', { url: url, metadataId: metadataId })
});

ee.on('metadata.wikis.new', async ({ url, metadataId }) => {
    // get the url without the protocol
    const urlNoProt = url.split("//")[1]
    // Create the item
    world.queueWork.itemCreate(queues.one, {
        labels: { en: urlNoProt },
        claims: {
            // Provide a basic set of claims, but let other things be filled in later.. (by the tidy)
            P1 : url,
            P3: "Q10", // wikibase site
            P13: 'Q54', // active
            P53: metadataId
        }
    }, { summary: `Importing ${url} from https://wikibase-metadata.toolforge.org` });
});