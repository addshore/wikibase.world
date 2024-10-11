import { queues, ee, HEADERS } from './../src/general.js';
import { fetchuc, fetchc } from './../src/fetch.js';

let graphqlURL = "https://wikibase-metadata.toolforge.org/graphql"
const generateQuery = (id) => {
    return `query MyQuery {
  wikibase(wikibaseId: ${id}) {
    id
    title
    organization
    location {
      country
      region
    }
    urls {
      baseUrl
      actionApi
      indexApi
      sparqlEndpointUrl
      sparqlUrl
      specialVersionUrl
    }
  }
}
`
}

let metadatalookup = async (id) => {
    // POST the query to the URL
    let postData  = {
        operationName: "MyQuery",
        query: generateQuery(id),
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
        return undefined
    }
    return data.data.wikibase
}

export { metadatalookup }