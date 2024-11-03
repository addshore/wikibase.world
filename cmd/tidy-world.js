import { simplifyClaims } from 'wikibase-sdk'
import { fetchuc, fetchc } from './../src/fetch.js';
import { world } from './../src/world.js';
import { queues, ee, HEADERS } from './../src/general.js';
import { metadatalookup } from './../src/metadata.js'
import { simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'
import dns from 'dns'

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

const worldWikis = await world.sparql.wikis();
const worldWikiURLs = worldWikis.map(wiki => wiki.site)
const worldWikiDomains = worldWikiURLs.map(url => new URL(url).hostname)
const worldWikiItems = worldWikis.map(wiki => wiki.item)

// Queue an initial lookup of live wikibase.world wikis
queues.many.add(async () => {
    // TODO don't lookup offline wikis (P13, Q57)
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

// Known reverse DNS records
const REVERSE_CLOUD = "221.76.141.34.bc.googleusercontent.com";
// const REVERSE_WBWIKI = "server-54-230-10-103.man50.r.cloudfront.net" // TODO check this one
const REVERSE_WBWIKI = "server-108-138-217-36.lhr61.r.cloudfront.net"
const REVERSE_WIKIMEDIA = "text-lb.esams.wikimedia.org"
const REVERSE_WIKITIDE = "cp37.wikitide.net"

// Known world properties
const worldWikibseMetadataId = 'P53'
const worldLinksToWikibase = 'P55'
const worldLinkedFromWikibase = 'P56'

ee.on('world.wikis.alive', async ({ wiki, response }) => {

    // First, a very basic check to see if the URL we retrieved is a MediaWiki, otherwise just RUN AWAY!
    wiki.responseText = response.loadedText
    if (!wiki.responseText.includes('content="MediaWiki')) {
        console.log(`❌ The URL ${wiki.site} is not a MediaWiki, aborting for now...`)
        return
    }

    wiki.domain = wiki.site.replace('https://', '').replace('http://', '').split('/')[0]
    wiki.reverseDNS = await new Promise((resolve, reject) => {
        dns.lookup(wiki.domain, (err, address, family) => {
            if (err) {
                console.log(`❌ Failed to lookup the IP for ${wiki.domain}`);
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
    wiki.actionApi = (() => {
        let actionApiMatches = wiki.responseText.match(/<link rel="EditURI" type="application\/rsd\+xml" href="(.+?)"/)
        if (actionApiMatches) {
            let x = actionApiMatches[1].replace('?action=rsd', '');
            // if the url starts with //, make it https://
            if (x.startsWith('//')) {
                x = 'https:' + x
            }
            return x
        }
        return null
    })();
    wiki.restApi = (() => {
        if (wiki.actionApi) {
            return wiki.actionApi.replace('/api.php', '/rest.php')
        }
        return null
    })();
    // Lookup additional known infomation from the loaded main page meta data
    {
        // Look for <title>HandWiki</title> in the responseText
        wiki.title = wiki.responseText.match(/<title>(.+?)<\/title>/)[1]
        // Also look for <meta name="description" content="Wiki Encyclopedia of Knowledge"/>
        const descriptionMatch = wiki.responseText.match(/<meta name="description" content="(.+?)"/);
        wiki.metaDescription = descriptionMatch ? descriptionMatch[1] : undefined
        // Also look for <meta name="generator" content="MediaWiki 1.38.4"/>
        wiki.metaGenerator = wiki.responseText.match(/<meta name="generator" content="(.+?)"/)[1]
        wiki.mwVersion = wiki.metaGenerator.match(/MediaWiki (.+?)$/)[1]
        // language from "wgPageContentLanguage":"en"
        const languageMatch = wiki.responseText.match(/"wgPageContentLanguage":"(.+?)"/)
        wiki.language = languageMatch ? languageMatch[1] : 'en'
    }

    // Lookup the item for the site on wikibase.world
    {
        const { entities } = await fetchuc(world.sdk.getEntities({ids: [ wiki.item ]}), { headers: HEADERS }).then(res => res.json())
        wiki.entity = entities[wiki.item]
        wiki.simpleClaims = simplifyClaims(wiki.entity.claims)
    }

    // Based on the item, lookup some additional stuff
    {
        // Lookup P53 (wikibase metadata ID), and thus the data from the metadata site
        if (wiki.simpleClaims[worldWikibseMetadataId]) {
            if (wiki.simpleClaims[worldWikibseMetadataId].length > 1) {
                console.log(`❌ The item ${wiki.item} has more than 1 P53 claim`)
            } else {
                wiki.wbmetadata = await metadatalookup(wiki.simpleClaims[worldWikibseMetadataId])
            }
        }
    }

    {
        // Lookup external links used in the item and property namespace :D
        // https://wikifcd.wikibase.cloud/w/api.php?action=query&list=exturlusage&euprotocol=https&eulimit=500&eunamespace=120|122&euprop=url
        wiki.urlDomains = new Set();
        let loops = 0;
        const limitExternalLinkLoops = 350;
        // Ignore these, as we don't really want to do the links for them
        const ignoreUrlLookupDomains = [
            'www.wikidata.org',
            'wikibase.world',
            'wikibase-registry.wmflabs.org',
            'commons.wikimedia.org',
        ]
        // TODO skip this if the starting URL we started with redirected to another domain (like registry to wikibase.world)
        if (wiki.actionApi && !ignoreUrlLookupDomains.includes(new URL(wiki.actionApi).hostname)) {
            let continueToken = '';
            do {
                loops++;
                let externalLinksUrl = wiki.actionApi + `?format=json&action=query&list=exturlusage&euprotocol=https&eulimit=500&eunamespace=120|122&euprop=url`;
                if (continueToken) {
                    externalLinksUrl += `&eucontinue=${continueToken}`;
                }
                try {
                    const externalLinksResponse = await fetchc(externalLinksUrl, { headers: HEADERS }).then(res => res.json());
                    externalLinksResponse.query.exturlusage.forEach(link => {
                        try {
                            const domain = new URL(link.url).hostname;
                            wiki.urlDomains.add(domain);
                        } catch (e) {
                            console.log(`❌ Failed to parse URL ${link.url}`);
                        }
                    });
                    continueToken = externalLinksResponse.continue ? externalLinksResponse.continue.eucontinue : '';
                } catch (e) {
                    console.log(`❌ Failed to get the external links for ${wiki.site}` + e);
                    break;
                }
            } while (continueToken && loops < limitExternalLinkLoops); // Only try 100 loops?
        }
        if (loops >= limitExternalLinkLoops) {
            console.log(`❌ Too many loops for external links for ${wiki.site}`); // If we hit this, we might have to come up with another method? maybe search? OR looking domain by domain for known domains?
        }
        wiki.urlDomains = [...wiki.urlDomains]; // Convert Set to Array if needed
    }

    // lookup manifest if it is on
    // w/rest.php/wikibase-manifest/v0/
    wiki.wbManifestData = null
    if (wiki.restApi) {
        try {
            const wbManifestUrl = wiki.restApi + "/wikibase-manifest/v0/manifest"
            const wbManifestResponse = await fetchc(wbManifestUrl, { headers: HEADERS })
            if (wbManifestResponse.status === 200) {
                wiki.wbManifestData = await wbManifestResponse.json()
            }
        } catch (e) {
            console.log(`❌ Failed to get the manifest for ${wiki.site}`)
        }
    }
    wiki.wdEquivProps = wiki.wbManifestData && wiki.wbManifestData.equiv_entities && wiki.wbManifestData.equiv_entities['wikidata.org'] ? wiki.wbManifestData.equiv_entities['wikidata.org'].properties : []
    wiki.wdEquivFormatterUrlProp = wiki.wdEquivProps ? wiki.wdEquivProps.P1630 : undefined

    // Lookup the formatter URLs of any known formatter URL properties
    {
        const sparqlFormatterURLPropertyData = await (async () => {
            // TODO, dont just use domain in this query, look it up from manifest
            const sparqlQuery = `
            PREFIX wdt: <https://${wiki.domain}/prop/direct/>
            PREFIX wd: <https://${wiki.domain}/entity/>
            SELECT ?property ?formatter WHERE {
            ?property wdt:${wiki.wdEquivFormatterUrlProp} ?formatter.
            }
            `
            const url = `https://${wiki.domain}/query/sparql?format=json&query=${encodeURIComponent(sparqlQuery)}`
            try {
                const raw = await fetchc(url, { headers: HEADERS }).then(res => res.json())
                return minimizeSimplifiedSparqlResults(simplifySparqlResults(raw))
            } catch (e) {
                console.log(`❌ Failed to get the formatter URL property data for ${wiki.site}`)
                return []
            }
        })();
    
        // Find all domains for sparqlFormatterURLPropertyData
        wiki.formattedExternalIdDomains = []
        try {
            wiki.formattedExternalIdDomains = sparqlFormatterURLPropertyData.map(data => new URL(data.formatter).hostname)
        } catch (e) {
            // Some formatter "urls" are just $1 for example...
            console.log(`❌ Failed to get the domains for the formatter URL property data for ${wiki.site}`)
        }
    }

    ////////////////////////////////
    // Start processing now we know stuff
    ////////////////////////////////

    // Find all domains that we link to via either 1) formatted external identifiers, or 2) URLs
    // If those domains in turn are already known on wikibase.world, then add statements to the world items linking them together
    {
        const knownDomains = [...new Set([...wiki.urlDomains, ...wiki.formattedExternalIdDomains])].filter(domain => worldWikiDomains.includes(domain))
        const knownDomainQids = knownDomains.map(domain => {
            let index = worldWikiDomains.indexOf(domain)
            return worldWikiItems[index]
        })
        // if they are known, and we have a qid, then we can add a claim to the world item
        knownDomainQids.forEach(qid => {
            // Skip things linking to themselves
            if (qid == wiki.item) {
                return
            }
            // Skip anything linked from => wikibase.world, wikibase-registry
            if (wiki.item == 'Q3' || wiki.item == 'Q58') {
                return
            }
            world.queueWork.claimEnsure(queues.four, { id: wiki.item, property: worldLinksToWikibase, value: qid }, { summary: `Add [[Property:${worldLinksToWikibase}]] via "External Identifiers" and "URLs" to [[Item:${qid}]]` })
            world.queueWork.claimEnsure(queues.four, { id: qid, property: worldLinkedFromWikibase, value: wiki.item }, { summary: `Add [[Property:${worldLinkedFromWikibase}]] via "External Identifiers" and "URLs" from [[Item:${wiki.item}]]` })
        })
    }

    // Try to modify labels descriptions and alias to the best of our ability
    // Figure out what we have, add what we think we could, try to use a good label, and if we have to, use the domain
    {
        let probablyGoodLabels = []
        if (wiki.title) {
            probablyGoodLabels.push(wiki.title)
        }

        if (wiki.language === 'en') {
            // Figure out what we have
            probablyGoodLabels.push(wiki.domain)
            // Remove "Main Page - " from any of the starts of the probablyGoodLabels
            probablyGoodLabels = probablyGoodLabels.map(label => label.replace('Main Page - ', ''))
            // Remove any that still inclyude Main Page
            probablyGoodLabels = probablyGoodLabels.filter(label => !label.includes('Main Page'))
            // Remove any that is wikibase-docker
            probablyGoodLabels = probablyGoodLabels.filter(label => !label.includes('wikibase-docker'))
            // And make it unique and remove any empty strings
            probablyGoodLabels = [...new Set(probablyGoodLabels)].filter(label => label !== '')

            // Figure out the current state
            let allEnLabelsAndAliases = []
            let enLabelIsDomain = false
            if (wiki.entity.labels.en) {
                allEnLabelsAndAliases.push(wiki.entity.labels.en.value)
                if (wiki.entity.labels.en.value === wiki.domain) {
                    enLabelIsDomain = true
                }
            }
            if (wiki.entity.aliases.en) {
                wiki.entity.aliases.en.forEach(alias => {
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
                    wiki.entity.labels.en = undefined
                    missingLabels.push(wiki.domain)
                }
                // if there is no label, set the first thing there
                if (!wiki.entity.labels.en) {
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
            if (wiki.metaDescription && !wiki.entity.descriptions.en) {
                world.queueWork.descriptionSet(queues.one, { id: wiki.item, language: 'en', value: wiki.metaDescription }, { summary: `Add en description from Main Page HTML` })
            }
        }
    }

    // Add MediaWiki version, if not set
    if (!wiki.simpleClaims.P57) {
        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P57', value: wiki.mwVersion }, { summary: `Add [[Property:P57]] claim for ${wiki.mwVersion}, extracted from home page meta data` })
    } else {
        // If there is more than 1 version, die for now?
        if (wiki.simpleClaims.P57.length > 1) {
            console.log(`❌ The item ${wiki.item} has more than 1 P57 claim`)
        } else {
            // If the version is different, update it
            if (wiki.simpleClaims.P57[0] !== wiki.mwVersion) {
                // TODO account for qualifiers and references?
                world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P57', oldValue: wiki.simpleClaims.P57[0], newValue: wiki.mwVersion }, { summary: `Update [[Property:P57]] claim for ${wiki.mwVersion}, extracted from home page meta data` })
            }
        }
    }

    // If the item does not have a P13 claim, then ensure P13 -> Q54, as the site appears online
    // Note this doesnt change the claim, as redirects are followed, and might result in a site appearing online when it is not, such as wikibase-registry
    if (!wiki.simpleClaims.P13 ) {
        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P13', value: 'Q54' }, { summary: `Add [[Property:P13]] claim for [[Item:Q54]] based on the fact it respondes with a 200 of MediaWiki` })
    }

    // If the domain ends in .wikibase.cloud
    if (wiki.domain.endsWith('.wikibase.cloud') || wiki.reverseDNS.includes(REVERSE_CLOUD)) {
        let hostBy = ''
        if (wiki.domain.endsWith('.wikibase.cloud')) {
            hostBy = ' (from the domain)'
        } else {
            hostBy = ' (from reverse DNS)'
        }

        // Then ensure P2 (Host) -> Q8 (Wikibase.cloud) on the world item
        if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== 'Q8') {
            world.queueWork.claimEnsure(queue, { id: wiki.item, property: 'P2', value: 'Q8' }, { summary: `Add [[Property:P2]] claim for [[Item:Q8]] based on [[Property:P1]] of ${wiki.site}` + hostBy })
        }
        // We also know a variaty of URLs, as they are determined by the platform
        // P7 query service UI
        // P8 query service SPARQL endpoint
        // P49 Main Page URL
        // Techncially the UI rediretcs to includes a '/' so allow that
        let protocolledDomain = 'https://' + wiki.domain
        if (!wiki.simpleClaims.P7 || (wiki.simpleClaims.P7.length <= 1 && !wiki.simpleClaims.P7.includes(protocolledDomain + '/query') && !wiki.simpleClaims.P7.includes(protocolledDomain + '/query/'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P7', value: protocolledDomain + '/query' }, { summary: `Add [[Property:P7]] claim for ${protocolledDomain}/query as it is known for [[Item:Q8]] hosted wikis` })
        }
        if (!wiki.simpleClaims.P8 || (wiki.simpleClaims.P8.length <= 1 && wiki.simpleClaims.P8[0] !== protocolledDomain + '/query/sparql')) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P8', value: protocolledDomain + '/query/sparql' }, { summary: `Add [[Property:P8]] claim for ${protocolledDomain}/query/sparql as it is known for [[Item:Q8]] hosted wikis` })
        }
        if (!wiki.simpleClaims.P49 || (wiki.simpleClaims.P49.length <= 1 && wiki.simpleClaims.P49[0] !== protocolledDomain + '/wiki/Main_Page')) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P49', value: protocolledDomain + '/wiki/Main_Page' }, { summary: `Add [[Property:P49]] claim for ${protocolledDomain}/wiki/Main_Page as it is known for [[Item:Q8]] hosted wikis` })
        }

        // We can also add P37 (wiki tool used), for a bunch of things...
        // Q285 is the query service
        // Q287 is cradle
        // Q286 is quickstatements
        if (!wiki.simpleClaims.P37 || (!wiki.simpleClaims.P37.includes('Q285'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q285', qualifiers: {'P7': protocolledDomain + '/query', 'P8': protocolledDomain + '/query/sparql'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q285]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!wiki.simpleClaims.P37 || (!wiki.simpleClaims.P37.includes('Q287'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q287', qualifiers: {'P1': protocolledDomain + '/tools/cradle'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q287]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!wiki.simpleClaims.P37 || (!wiki.simpleClaims.P37.includes('Q286'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P37', value: 'Q286', qualifiers: {'P1': protocolledDomain + '/tools/quickstatements'} }, { summary: `Add [[Property:P37]] claim for [[Item:Q286]] based on the fact it is a wikibase.cloud wiki` })
        }

        // All wikibase.cloud sites also support items and properties...
        // SO P12 should have a statement for Q51 and Q52
        if (!wiki.simpleClaims.P12 || (!wiki.simpleClaims.P12.includes('Q51'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P12', value: 'Q51' }, { summary: `Add [[Property:P12]] claim for [[Item:Q51]] based on the fact it is a wikibase.cloud wiki` })
        }
        if (!wiki.simpleClaims.P12 || (!wiki.simpleClaims.P12.includes('Q52'))) {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P12', value: 'Q52' }, { summary: `Add [[Property:P12]] claim for [[Item:Q52]] based on the fact it is a wikibase.cloud wiki` })
        }
    } else {
        // console.log(wiki.domain + " -> " + wiki.reverseDNS)
    }

    // If the domain ends in wikibase.wiki
    if (wiki.site.endsWith('.wikibase.wiki')) {
        // Then ensure P2 (Host) -> Q7 (The Wikibase Consultancy)
        if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== 'Q7') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q7' }, { summary: `Add [[Property:P2]] claim for [[Item:Q7]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    // If the domain ends in miraheze.org, then it is hosted by Q118
    if (wiki.site.endsWith('.miraheze.org')) {
        if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== 'Q118') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q118' }, { summary: `Add [[Property:P2]] claim for [[Item:Q118]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    // ends with .wmflabs.org, hosted by https://wikibase.world/wiki/Item:Q6
    if (wiki.site.endsWith('.wmflabs.org')) {
        if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== 'Q6') {
            world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P2', value: 'Q6' }, { summary: `Add [[Property:P2]] claim for [[Item:Q6]] based on [[Property:P1]] of ${wiki.site}` })
        }
    }

    if (wiki.actionApi) {
        // Try to figure out the inception date (P5), based on when the first edit was made
        // We can find this by using the API, such as https://furry.wikibase.cloud/w/api.php?action=query&list=logevents&ledir=newer&lelimit=1&format=json
        // And getting .query.logevents[0].timestamp
        queues.many.add(async () => {
            try{
                const logApiUrl = wiki.actionApi + '?action=query&list=logevents&ledir=newer&lelimit=1&format=json'
                const actionApiResponse = await fetchc(logApiUrl, { headers: HEADERS }).then(res => res.json())
                if (actionApiResponse.query.logevents.length != 1) {
                    console.log(`❌ Failed to get the inception date for ${wiki.site}`)
                }
                // Timestamp is like 2020-02-11T18:11:02Z
                const inceptionDate = actionApiResponse.query.logevents[0].timestamp.split('T')[0]
                // if there is no P5 claim, add one
                if (!wiki.simpleClaims.P5) {
                    const today = new Date().toISOString().split('T')[0]
                    world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P5', value: inceptionDate, references: { P21: logApiUrl, P22: today } }, { summary: `Add [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` })
                }
                // if there is a P5 claim, and it has the same value, and no reference, add the reference
                // TODO consider adding an additions reference, if it aleady has one, but not the logApiUrl
                if (wiki.simpleClaims.P5 && wiki.simpleClaims.P5.length <= 1 && wiki.simpleClaims.P5[0].split('T')[0] === inceptionDate && wiki.entity.claims.P5[0].references === undefined) {
                    const today = new Date().toISOString().split('T')[0]
                    const guid = wiki.entity.claims.P5[0].id
                    world.queueWork.referenceSet(queues.one, { guid, snaks: { P21: logApiUrl, P22: today } }, { summary: `Add references to [[Property:P5]] claim for ${inceptionDate} based on the first log entry of the wiki` })
                }
            } catch (e) {
                console.log(`❌ Failed to get the inception date for ${wiki.site}`)
            }
        });
        // Try to figure out the number of properties based on the API listing pages in the "extepected" property namespace
        queues.many.add(async () => {
            // api.php?action=query&list=allpages&apnamespace=122&aplimit=5000
            try{
                // First, find the property namespace..
                // do api.php?action=query&meta=siteinfo&siprop=namespaces
                // and find the namespace with "defaultcontentmodel" or "wikibase-property"
                const siteInfoApiUrl = wiki.actionApi + '?action=query&meta=siteinfo&siprop=namespaces|statistics&format=json'
                const siteInfoApiResponse = await fetchc(siteInfoApiUrl, { headers: HEADERS }).then(res => res.json())

                // Look for query.statistics.pages (P62)
                // also query.statistics.edits (P59)
                // also query.statistics.users (P60)
                // also query.statistics.activeusers (P61)
                // Add them all to the item

                const statistics = siteInfoApiResponse.query.statistics
                if (statistics) {
                    if (!wiki.simpleClaims.P62) {
                        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P62', value: { amount: statistics.pages } }, { summary: `Add [[Property:P62]] claim for ${statistics.pages} based on the number of pages in the wiki (mediawiki statistics)` })
                    } else {
                        // If there is more than 1 P62 claim
                        if (wiki.simpleClaims.P62.length > 1) {
                            console.log(`❌ The item ${wiki.item} has more than 1 P62 claim`)
                        } else {
                            // If the value is different, update it
                            if (wiki.simpleClaims.P62[0] !== statistics.pages) {
                                // TODO account for qualifiers and references?
                                world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P62', oldValue: wiki.simpleClaims.P62[0], newValue: { amount: statistics.pages } }, { summary: `Update [[Property:P62]] claim for ${statistics.pages} based on the number of pages in the wiki (mediawiki statistics)` })
                            }
                        }
                    }
                    if (!wiki.simpleClaims.P59) {
                        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P59', value: { amount: statistics.edits } }, { summary: `Add [[Property:P59]] claim for ${statistics.edits} based on the number of edits in the wiki (mediawiki statistics)` })
                    } else {
                        // If there is more than 1 P59 claim
                        if (wiki.simpleClaims.P59.length > 1) {
                            console.log(`❌ The item ${wiki.item} has more than 1 P59 claim`)
                        } else {
                            // If the value is different, update it
                            if (wiki.simpleClaims.P59[0] !== statistics.edits) {
                                // TODO account for qualifiers and references?
                                world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P59', oldValue: wiki.simpleClaims.P59[0], newValue: { amount: statistics.edits } }, { summary: `Update [[Property:P59]] claim for ${statistics.edits} based on the number of edits in the wiki (mediawiki statistics)` })
                            }
                        }
                    }
                    if (!wiki.simpleClaims.P60) {
                        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P60', value: { amount: statistics.users } }, { summary: `Add [[Property:P60]] claim for ${statistics.users} based on the number of users in the wiki (mediawiki statistics)` })
                    } else {
                        // If there is more than 1 P60 claim
                        if (wiki.simpleClaims.P60.length > 1) {
                            console.log(`❌ The item ${wiki.item} has more than 1 P60 claim`)
                        } else {
                            // If the value is different, update it
                            if (wiki.simpleClaims.P60[0] !== statistics.users) {
                                // TODO account for qualifiers and references?
                                world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P60', oldValue: wiki.simpleClaims.P60[0], newValue: { amount: statistics.users } }, { summary: `Update [[Property:P60]] claim for ${statistics.users} based on the number of users in the wiki (mediawiki statistics)` })
                            }
                        }
                    }
                    if (!wiki.simpleClaims.P61) {
                        world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P61', value: { amount: statistics.activeusers } }, { summary: `Add [[Property:P61]] claim for ${statistics.activeusers} based on the number of active users in the wiki (mediawiki statistics)` })
                    } else {
                        // If there is more than 1 P61 claim
                        if (wiki.simpleClaims.P61.length > 1) {
                            console.log(`❌ The item ${wiki.item} has more than 1 P61 claim`)
                        } else {
                            // If the value is different, update it
                            if (wiki.simpleClaims.P61[0] !== statistics.activeusers) {
                                // TODO account for qualifiers and references?
                                world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P61', oldValue: wiki.simpleClaims.P61[0], newValue: { amount: statistics.activeusers } }, { summary: `Update [[Property:P61]] claim for ${statistics.activeusers} based on the number of active users in the wiki (mediawiki statistics)` })
                            }
                        }
                    }
                }

                const propertyNamespaceId = Object.keys(siteInfoApiResponse.query.namespaces).find(key => siteInfoApiResponse.query.namespaces[key].defaultcontentmodel === 'wikibase-property')
                if (!propertyNamespaceId) {
                    console.log(`❌ Failed to find the property namespace for ${wiki.site}`)
                    return
                }

                const pageLoopLimit = 20 * 500
                let allPagesSoFar = 0
                let retrievingPages = true
                let extraPagigParams = ''
                // loop while retrievingPages is true
                do {
                    const allPagesApiUrl = wiki.actionApi + '?action=query&list=allpages&apnamespace=' + propertyNamespaceId + '&aplimit=500&format=json' + extraPagigParams
                    const allPagesApiResponse = await fetchc(allPagesApiUrl, { headers: HEADERS }).then(res => res.json())
                    // if there is a warning key in the response, bail
                    if (allPagesApiResponse.warnings) {
                        console.log(`❌ Failed to get the number of properties for ${wiki.site}`)
                        console.log(allPagesApiResponse.warnings)
                        return
                    }
                    allPagesSoFar += allPagesApiResponse.query.allpages.length
                    // if there is a continue key in the response, bail
                    if (allPagesApiResponse.continue) {
                        // "batchcomplete": "",
                        // "continue": {
                        //     "apcontinue": "P10",
                        //     "continue": "-||"
                        // },
                        // do the same request again, but with the apcontinue parameter,
                        const continueToken = allPagesApiResponse.continue.apcontinue
                        extraPagigParams = '&apcontinue=' + continueToken
                    } else {
                        retrievingPages = false
                    }
                    if (allPagesSoFar > pageLoopLimit) {
                        console.log(`❌ The item ${wiki.item} has more than ${pageLoopLimit} properties`)
                        return
                    }
                } while (retrievingPages)

                // P58 is the "number of properties" property
                if (!wiki.simpleClaims.P58) {
                    world.queueWork.claimEnsure(queues.one, { id: wiki.item, property: 'P58', value: { amount: allPagesSoFar } }, { summary: `Add [[Property:P58]] claim for ${allPagesSoFar} based on the number of properties in the property namespace` })
                } else {
                    // If there is more than 1 P58 claim
                    if (wiki.simpleClaims.P58.length > 1) {
                        console.log(`❌ The item ${wiki.item} has more than 1 P58 claim`)
                    } else {
                        // If the value is different, update it
                        if (wiki.simpleClaims.P58[0] !== allPagesSoFar) {
                            // TODO account for qualifiers and references?
                            world.queueWork.claimUpdate(queues.one, { id: wiki.item, property: 'P58', oldValue: wiki.simpleClaims.P58[0], newValue: { amount: allPagesSoFar } }, { summary: `Update [[Property:P58]] claim for ${allPagesSoFar} based on the number of properties in the property namespace` })
                        }
                    }
                }
            } catch (e) {
                console.log(`❌ Failed to get the number of properties, users, stats etc for ${wiki.site}`)
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
                    if (wiki.simpleClaims.P1.length > 1) {
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
