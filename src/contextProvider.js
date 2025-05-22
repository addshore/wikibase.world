import { fetchc } from './fetch.js';
import { HEADERS } from './general.js';
import dns from 'node:dns/promises';
import { world } from './world.js'; // Added import for world
import { simplifyClaims, simplifySparqlResults, minimizeSimplifiedSparqlResults } from 'wikibase-sdk'; // Added imports for wikibase-sdk utilities
import { actionApigetPageCount, actionAPIgetMaxEntityIdInt } from './site.js'; // Added for stats

class ContextProvider {
  constructor(options = {}) {
    // Options could include cache settings, logger, etc.
    this.cache = new Map(); // Simple in-memory cache for now
    // TODO: Implement more sophisticated caching (e.g., file-based) if needed
  }

  async getMainPageHtml(url) {
    const cacheKey = `html_${url}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      console.log(`Fetching main page HTML for ${url}...`);
      const response = await fetchc(url, { headers: HEADERS });
      if (!response.ok) {
        // Use response.status for the HTTP status code
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      const html = await response.text();
      this.cache.set(cacheKey, html);
      console.log(`Successfully fetched HTML for ${url}. Length: ${html.length}`);
      return html;
    } catch (error) {
      console.error(`Error fetching main page HTML for ${url}:`, error.message);
      return null;
    }
  }

  async getReverseDNS(domain) {
    const cacheKey = `rdns_${domain}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      console.log(`Performing DNS lookup for ${domain}...`);
      const addresses = await dns.lookup(domain, { all: true });
      if (!addresses || addresses.length === 0) {
        console.warn(`No IP address found for ${domain}`);
        this.cache.set(cacheKey, []);
        return [];
      }

      // Perform reverse DNS lookup for the first resolved address
      // Note: A domain can resolve to multiple IPs; rDNS might differ.
      // For simplicity, we'll use the first one. Consider if more complex logic is needed.
      const primaryIpAddress = addresses[0].address;
      console.log(`Performing reverse DNS lookup for IP ${primaryIpAddress} (from ${domain})...`);
      const hostnames = await dns.reverse(primaryIpAddress);
      this.cache.set(cacheKey, hostnames);
      console.log(`Reverse DNS for ${primaryIpAddress} (from ${domain}): ${hostnames.join(', ')}`);
      return hostnames;
    } catch (error) {
      // Log specific errors for DNS vs rDNS
      if (error.syscall === 'getaddrinfo') {
        console.error(`Error performing DNS lookup for ${domain}:`, error.message);
      } else if (error.syscall === 'getnameinfo') {
        // This can happen if the IP has no rDNS record, which is common.
        console.warn(`Error performing reverse DNS lookup for an IP of ${domain} (this might be expected):`, error.message);
        this.cache.set(cacheKey, []); // Cache empty result for no rDNS
        return [];
      } else {
        console.error(`Generic DNS/rDNS error for ${domain}:`, error.message);
      }
      this.cache.set(cacheKey, []); // Cache empty result on error
      return [];
    }
  }
  
  extractApiEndpoints(html, baseUrl) {
    const context = {};
    // Extract Action API URL
    // <link rel="EditURI" type="application/rsd+xml" href="http://localhost:8181/w/api.php?action=rsd"/>
    const actionApiMatch = html.match(/<link rel="EditURI" type="application\/rsd\+xml" href="(.+?)"/);
    if (actionApiMatch && actionApiMatch[1]) {
      let actionApiUrl = actionApiMatch[1].replace('?action=rsd', '');
      if (actionApiUrl.startsWith('//')) {
        actionApiUrl = new URL(baseUrl).protocol + actionApiUrl;
      } else if (!actionApiUrl.startsWith('http')) {
        const base = new URL(baseUrl);
        actionApiUrl = new URL(actionApiUrl, base).href;
      }
      context.actionApi = actionApiUrl;
      console.log(`Extracted Action API URL: ${context.actionApi}`);

      // Derive REST API URL from Action API URL
      // Assumes REST base is at /rest.php at the same level as api.php
      try {
        const apiUrlObject = new URL(context.actionApi);
        const pathParts = apiUrlObject.pathname.split('/');
        pathParts.pop(); // Remove api.php
        pathParts.push('rest.php'); // Add rest.php
        apiUrlObject.pathname = pathParts.join('/');
        context.restApi = apiUrlObject.href;
        console.log(`Derived REST API URL: ${context.restApi}`);
      } catch(e) {
        console.warn(`Could not derive REST API URL from ${context.actionApi}: ${e.message}`);
        context.restApi = null;
      }
    } else {
      console.warn('Could not find Action API URL in HTML.');
      context.actionApi = null;
      context.restApi = null;
    }
    return context;
  }

  extractPageMetadata(html) {
    const metadata = {};
    // <title>HandWiki</title>
    const titleMatch = html.match(/<title>(.+?)<\/title>/);
    metadata.title = titleMatch ? titleMatch[1] : null;
    if(metadata.title) console.log(`Extracted Title: ${metadata.title}`); else console.warn('Could not extract Title.');

    // <meta name="description" content="Wiki Encyclopedia of Knowledge"/>
    const descriptionMatch = html.match(/<meta name="description" content="(.+?)"/);
    metadata.metaDescription = descriptionMatch ? descriptionMatch[1] : null;
    if(metadata.metaDescription) console.log(`Extracted Meta Description: ${metadata.metaDescription}`); else console.warn('Could not extract Meta Description.');
    
    // <meta name="generator" content="MediaWiki 1.38.4"/>
    const generatorMatch = html.match(/<meta name="generator" content="(.+?)"/);
    if (generatorMatch && generatorMatch[1]) {
        metadata.metaGenerator = generatorMatch[1];
        if(metadata.metaGenerator) console.log(`Extracted Meta Generator: ${metadata.metaGenerator}`); else console.warn('Could not extract Meta Generator.');
        const mwVersionMatch = metadata.metaGenerator.match(/MediaWiki (.+?)$/);
        metadata.mwVersion = mwVersionMatch ? mwVersionMatch[1] : null;
        if(metadata.mwVersion) console.log(`Extracted MediaWiki Version: ${metadata.mwVersion}`); else console.warn('Could not extract MediaWiki Version from Generator tag.');
    } else {
        metadata.metaGenerator = null;
        metadata.mwVersion = null;
        console.warn('Could not extract Meta Generator or MediaWiki Version.');
    }

    // language from "wgPageContentLanguage":"en"
    const languageMatch = html.match(/"wgPageContentLanguage":"(.+?)"/);
    metadata.language = languageMatch ? languageMatch[1] : 'en'; // Default to 'en' if not found
    console.log(`Extracted Language: ${metadata.language}`);
    
    return metadata;
  }

  async getContext(wikibaseUrl) {
    console.log(`Starting context gathering for: ${wikibaseUrl}`);
    const context = {
      url: wikibaseUrl,
      domain: null,
      mainPageHtml: null,
      reverseDNS: [],
      actionApi: null,
      restApi: null,
      title: null,
      metaDescription: null,
      metaGenerator: null,
      mwVersion: null,
      language: 'en', // Default
      // Placeholders for more data
      wikibaseWorldEntity: null,
      wikibaseWorldQid: null,
      wikibaseWorldSimpleClaims: null,
      // externalLinks: [], // Replaced by externalLinkDomains
      wikibaseManifestData: null, // Renamed from wikibaseManifest for clarity
      // statistics: {}, // Replaced by siteStatistics, propertyCount, maxItemId
      inceptionDate: null,
      worldWikis: [],
      externalLinkDomains: [],
      formatterUrlPatternDomains: [],
      siteStatistics: null, // New
      namespacesData: null, // New - for internal use or debugging
      propertyCount: null, // New
      maxItemId: null, // New
    };

    try {
      const urlObject = new URL(wikibaseUrl);
      context.domain = urlObject.hostname;
      console.log(`Domain: ${context.domain}`);
    } catch (error) {
      console.error(`Invalid URL: ${wikibaseUrl}. Error: ${error.message}`);
      context.error = `Invalid URL: ${error.message}`;
      return context;
    }

    // 1. Get Main Page HTML
    context.mainPageHtml = await this.getMainPageHtml(wikibaseUrl);
    if (!context.mainPageHtml) {
      console.error(`Failed to get main page HTML for ${wikibaseUrl}. Further context gathering may be incomplete.`);
      context.error = context.error ? context.error + '; Failed to get main page HTML' : 'Failed to get main page HTML';
      return context;
    }

    // 2. Extract API endpoints from HTML
    const apiEndpoints = this.extractApiEndpoints(context.mainPageHtml, wikibaseUrl);
    context.actionApi = apiEndpoints.actionApi;
    context.restApi = apiEndpoints.restApi;
    
    // 3. Extract page metadata from HTML
    const pageMetadata = this.extractPageMetadata(context.mainPageHtml);
    Object.assign(context, pageMetadata);

    // 4. Get Reverse DNS
    if (context.domain) {
      context.reverseDNS = await this.getReverseDNS(context.domain);
    }

    // 5. Fetch Wikibase.world entity data
    const worldEntityData = await this.getWikibaseWorldEntity(wikibaseUrl);
    if (worldEntityData) {
      context.wikibaseWorldQid = worldEntityData.qid;
      context.wikibaseWorldEntity = worldEntityData.entity;
      context.wikibaseWorldSimpleClaims = worldEntityData.simpleClaims;
    }

    // 6. Get list of all wikis from wikibase.world
    context.worldWikis = await this.getWorldWikisList();

    // 7. Fetch Wikibase manifest if restApi is available
    if (context.restApi) {
      context.wikibaseManifestData = await this.getWikibaseManifest(context.restApi);
    }

    // 8. Fetch statistics and entity counts if actionApi is available
    if (context.actionApi) {
      context.siteStatistics = await this.getSiteInfoStatistics(context.actionApi);
      context.namespacesData = await this.getSiteNamespaceData(context.actionApi); // Store for potential reuse
      if (context.namespacesData) {
        context.propertyCount = await this.getPropertyCount(context.actionApi, context.namespacesData);
        context.maxItemId = await this.getMaxItemId(context.actionApi, context.namespacesData);
      }
    }

    // 9. Fetch external link domains if actionApi is available
    if (context.actionApi) {
      context.externalLinkDomains = await this.getExternalLinkDomains(context.actionApi);
    }

    // 10. Fetch formatter URL pattern domains if actionApi, domain, and manifest are available
    if (context.actionApi && context.domain && context.wikibaseManifestData) {
      context.formatterUrlPatternDomains = await this.getFormatterUrlPatternDomains(context.actionApi, context.domain, context.wikibaseManifestData);
    }
    
    // TODO: Fetch inception date (requires actionApi)

    console.log(`Finished context gathering for: ${wikibaseUrl}`);
    return context;
  }

  async getWikibaseWorldEntity(siteUrl) {
    const cacheKey = `wbWorldEntity_${siteUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    console.log(`Fetching Wikibase.world entity data for ${siteUrl}...`);

    try {
      // 1. Find QID by Site URL (P1)
      const sparqlQuery = `
        PREFIX wdt: <https://wikibase.world/prop/direct/>
        SELECT ?item WHERE {
          ?item wdt:P1 <${siteUrl}>.
        }
        LIMIT 1
      `;
      const queryUrl = world.sdk.sparqlQuery(sparqlQuery);
      console.log(`Querying Wikibase.world for QID with URL: ${queryUrl}`);
      const response = await fetchc(queryUrl, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
      }
      const results = await response.json();
      const simplifiedResults = minimizeSimplifiedSparqlResults(simplifySparqlResults(results));

      if (!simplifiedResults || simplifiedResults.length === 0 || !simplifiedResults[0].item) {
        console.warn(`No Wikibase.world entity found for site URL: ${siteUrl}`);
        this.cache.set(cacheKey, null);
        return null;
      }
      
      const qid = simplifiedResults[0].item;
      console.log(`Found Wikibase.world QID: ${qid} for ${siteUrl}`);

      // 2. Fetch Entity Data
      const entityUrl = world.sdk.getEntities({ ids: [qid], props: ['info', 'claims', 'labels', 'descriptions', 'aliases'] });
      console.log(`Fetching entity data for ${qid} from URL: ${entityUrl}`);
      const entityResponse = await fetchc(entityUrl, { headers: HEADERS });
      if (!entityResponse.ok) {
        throw new Error(`Failed to fetch entity ${qid}: ${entityResponse.status} ${entityResponse.statusText}`);
      }
      const entityData = await entityResponse.json();
      
      if (!entityData || !entityData.entities || !entityData.entities[qid]) {
        console.warn(`Could not retrieve entity data for ${qid}`);
        this.cache.set(cacheKey, null); // Cache null if entity not found despite QID
        return null;
      }

      const entity = entityData.entities[qid];
      const simpleClaims = simplifyClaims(entity.claims || {});
      
      const result = {
        qid,
        entity,
        simpleClaims
      };

      this.cache.set(cacheKey, result);
      console.log(`Successfully fetched and processed Wikibase.world entity ${qid} for ${siteUrl}.`);
      return result;

    } catch (error) {
      console.error(`Error fetching Wikibase.world entity for ${siteUrl}:`, error.message);
      this.cache.set(cacheKey, null); // Cache null on error to avoid retrying failing requests too often
      return null;
    }
  }

  async getWorldWikisList() {
    const cacheKey = 'worldWikisList';
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log('Fetching list of wikis from wikibase.world...');
    try {
      const sparqlQuery = `
        PREFIX wdt: <https://wikibase.world/prop/direct/>
        PREFIX wd: <https://wikibase.world/entity/>
        SELECT ?item ?site WHERE {
          ?item wdt:P3 wd:Q10.  # Instance of Wikibase
          ?item wdt:P1 ?site.
          FILTER NOT EXISTS { ?item wdt:P13 wd:Q57 } # Ignore permanently offline instances
          FILTER NOT EXISTS { ?item wdt:P13 wd:Q72 } # Ignore indefinitely offline instances
        }
      `;
      const url = world.sdk.sparqlQuery(sparqlQuery);
      const response = await fetchc(url, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`Failed to fetch world wikis list: ${response.status} ${response.statusText}`);
      }
      const rawResults = await response.json();
      const wikis = minimizeSimplifiedSparqlResults(simplifySparqlResults(rawResults));
      this.cache.set(cacheKey, wikis);
      console.log(`Successfully fetched ${wikis.length} active wikis from wikibase.world.`);
      return wikis;
    } catch (error) {
      console.error('Error fetching world wikis list:', error.message);
      this.cache.set(cacheKey, []); // Cache empty array on error
      return [];
    }
  }

  async getWikibaseManifest(restApiUrl) {
    const cacheKey = `manifest_${restApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const manifestUrl = `${restApiUrl.replace(/\/$/, '')}/wikibase-manifest/v0/manifest`;
    console.log(`Fetching Wikibase manifest from ${manifestUrl}...`);
    try {
      const response = await fetchc(manifestUrl, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest from ${manifestUrl}: ${response.status} ${response.statusText}`);
      }
      const manifestData = await response.json();
      this.cache.set(cacheKey, manifestData);
      console.log(`Successfully fetched Wikibase manifest for ${restApiUrl}.`);
      return manifestData;
    } catch (error) {
      console.error(`Error fetching Wikibase manifest for ${restApiUrl}:`, error.message);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getExternalLinkDomains(actionApiUrl) {
    const cacheKey = `externalLinks_${actionApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    console.log(`Fetching external link domains from ${actionApiUrl}...`);
    const allDomains = new Set();
    // Namespaces: 120 (Item), 122 (Property). Add others if needed.
    const namespacesToScan = [120, 122]; 
    let eucontinue = undefined;

    try {
      for (const ns of namespacesToScan) {
        eucontinue = undefined; // Reset for each namespace
        do {
          const params = new URLSearchParams({
            action: 'query',
            list: 'exturlusage',
            eunamespace: ns,
            eulimit: 'max', // Max 500 or 5000 for bots
            format: 'json',
          });
          if (eucontinue) {
            params.set('eucontinue', eucontinue);
          }
          const requestUrl = `${actionApiUrl}?${params.toString()}`;
          // console.log(`Fetching exturlusage page: ${requestUrl}`);
          const response = await fetchc(requestUrl, { headers: HEADERS });
          if (!response.ok) {
            throw new Error(`Failed to fetch exturlusage for ns ${ns} from ${actionApiUrl}: ${response.status} ${response.statusText}`);
          }
          const data = await response.json();
          if (data.query && data.query.exturlusage) {
            for (const usage of data.query.exturlusage) {
              try {
                const urlObject = new URL(usage.url);
                allDomains.add(urlObject.hostname);
              } catch (e) {
                // console.warn(`Invalid URL in exturlusage: ${usage.url}. Error: ${e.message}`);
              }
            }
          }
          eucontinue = data.continue ? data.continue.eucontinue : undefined;
        } while (eucontinue);
      }
      const uniqueDomainsArray = Array.from(allDomains);
      this.cache.set(cacheKey, uniqueDomainsArray);
      console.log(`Found ${uniqueDomainsArray.length} unique external link domains from ${actionApiUrl}.`);
      return uniqueDomainsArray;
    } catch (error) {
      console.error(`Error fetching external link domains from ${actionApiUrl}:`, error.message);
      this.cache.set(cacheKey, []);
      return [];
    }
  }

  async getFormatterUrlPatternDomains(actionApiUrl, domain, manifestData) {
    const cacheKey = `formatterDomains_${domain}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log(`Fetching formatter URL pattern domains for ${domain}...`);

    if (!manifestData || !manifestData.equiv_entities || !manifestData.equiv_entities['wikidata.org'] ||
        !manifestData.equiv_entities['wikidata.org'].properties || !manifestData.equiv_entities['wikidata.org'].properties.P1630) {
      console.warn(`[${domain}] Formatter URL property (equiv. to P1630) not found in manifest. Cannot fetch formatter domains.`);
      this.cache.set(cacheKey, []);
      return [];
    }
    const formatterPropertyId = manifestData.equiv_entities['wikidata.org'].properties.P1630;
    console.log(`[${domain}] Found equivalent of P1630: ${formatterPropertyId}`);

    // Construct SPARQL endpoint URL (convention-based)
    // Ideally, manifest would provide this.
    let sparqlEndpoint = '';
    try {
        const apiBase = new URL(actionApiUrl);
        // Common patterns: /w/api.php -> /query/sparql or /api.php -> /query/sparql
        // Or simply relative to the domain.
        if (apiBase.pathname.includes('/w/')) { // e.g. /w/api.php
            sparqlEndpoint = `${apiBase.protocol}//${apiBase.hostname}/w/query/sparql`;
        } else { // e.g. /api.php or just /
             sparqlEndpoint = `${apiBase.protocol}//${apiBase.hostname}/query/sparql`;
        }
        console.log(`[${domain}] Using conventional SPARQL endpoint: ${sparqlEndpoint}`);
    } catch (e) {
        console.error(`[${domain}] Could not construct SPARQL endpoint from actionApiUrl ${actionApiUrl}: ${e.message}`);
        this.cache.set(cacheKey, []);
        return [];
    }


    const sparqlQuery = `
      SELECT ?formatter WHERE {
        ?property wdt:${formatterPropertyId} ?formatter.
      }
    `;
    
    try {
      // Note: This uses WBK's sparqlQuery to build the URL, but fetchc to execute it.
      // This is fine, but ensure the endpoint is correct for the target wiki.
      const queryUrl = world.sdk.sparqlQuery(sparqlQuery, sparqlEndpoint); // Pass the target endpoint
      console.log(`[${domain}] Querying target wiki for formatter URLs: ${queryUrl}`);

      const response = await fetchc(queryUrl, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`[${domain}] SPARQL query for formatter URLs failed: ${response.status} ${response.statusText}`);
      }
      const results = await response.json();
      const simplifiedResults = minimizeSimplifiedSparqlResults(simplifySparqlResults(results));

      const formatterDomains = new Set();
      if (simplifiedResults && Array.isArray(simplifiedResults)) {
        for (const res of simplifiedResults) {
          if (res.formatter && typeof res.formatter === 'string') {
            try {
              // Attempt to parse as URL. If it fails, it's likely not a full URL (e.g., just "$1")
              // We are interested in full URLs that define a domain.
              const urlObject = new URL(res.formatter);
              formatterDomains.add(urlObject.hostname);
            } catch (e) {
              // Not a full URL, or invalid. Ignore.
              // console.log(`[${domain}] Formatter pattern "${res.formatter}" is not a full URL. Skipping domain extraction.`);
            }
          }
        }
      }
      const uniqueDomainsArray = Array.from(formatterDomains);
      this.cache.set(cacheKey, uniqueDomainsArray);
      console.log(`[${domain}] Found ${uniqueDomainsArray.length} unique formatter URL domains.`);
      return uniqueDomainsArray;

    } catch (error) {
      console.error(`[${domain}] Error fetching or processing formatter URL patterns:`, error.message);
      this.cache.set(cacheKey, []);
      return [];
    }
  }

}

export { ContextProvider };

  async getSiteInfoStatistics(actionApiUrl) {
    const cacheKey = `siteInfoStats_${actionApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log(`Fetching site statistics from ${actionApiUrl}...`);
    try {
      const params = new URLSearchParams({
        action: 'query',
        meta: 'siteinfo',
        siprop: 'statistics',
        format: 'json',
      });
      const requestUrl = `${actionApiUrl}?${params.toString()}`;
      const response = await fetchc(requestUrl, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`Failed to fetch siteinfo statistics: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      if (data.query && data.query.statistics) {
        const stats = data.query.statistics;
        const relevantStats = {
          pages: stats.pages,
          articles: stats.articles, // Often useful
          edits: stats.edits,
          users: stats.users,
          activeusers: stats.activeusers,
          images: stats.images, // Count of files
        };
        this.cache.set(cacheKey, relevantStats);
        console.log(`Successfully fetched site statistics for ${actionApiUrl}.`);
        return relevantStats;
      }
      throw new Error('Statistics data not found in siteinfo response.');
    } catch (error) {
      console.error(`Error fetching site statistics for ${actionApiUrl}:`, error.message);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getSiteNamespaceData(actionApiUrl) {
    const cacheKey = `siteNamespaces_${actionApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log(`Fetching site namespace data from ${actionApiUrl}...`);
    try {
      const params = new URLSearchParams({
        action: 'query',
        meta: 'siteinfo',
        siprop: 'namespaces',
        format: 'json',
      });
      const requestUrl = `${actionApiUrl}?${params.toString()}`;
      const response = await fetchc(requestUrl, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`Failed to fetch siteinfo namespaces: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      if (data.query && data.query.namespaces) {
        this.cache.set(cacheKey, data.query.namespaces);
        console.log(`Successfully fetched site namespace data for ${actionApiUrl}.`);
        return data.query.namespaces;
      }
      throw new Error('Namespaces data not found in siteinfo response.');
    } catch (error) {
      console.error(`Error fetching site namespace data for ${actionApiUrl}:`, error.message);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getPropertyCount(actionApiUrl, namespacesData) {
    const cacheKey = `propertyCount_${actionApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log(`Calculating property count for ${actionApiUrl}...`);
    if (!namespacesData) {
      console.warn('Namespaces data not provided to getPropertyCount. Cannot determine property namespace.');
      return null;
    }
    let propertyNamespaceId = null;
    for (const nsId in namespacesData) {
      if (namespacesData[nsId].defaultcontentmodel === 'wikibase-property') {
        propertyNamespaceId = parseInt(nsId, 10);
        break;
      }
    }

    if (propertyNamespaceId === null) {
      console.warn(`Could not find a Wikibase property namespace for ${actionApiUrl}.`);
      this.cache.set(cacheKey, null);
      return null;
    }
    console.log(`Found property namespace ID: ${propertyNamespaceId} for ${actionApiUrl}.`);

    try {
      // Using the imported actionApigetPageCount. Limit set to 50k for safety.
      const count = await actionApigetPageCount(actionApiUrl, propertyNamespaceId, 50000);
      this.cache.set(cacheKey, count);
      if (count !== null) {
        console.log(`Property count for ${actionApiUrl}: ${count}`);
      } else {
         console.warn(`Property count for ${actionApiUrl} could not be determined or exceeded limit.`);
      }
      return count;
    } catch (error) {
      console.error(`Error getting property count for ${actionApiUrl}:`, error.message);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  async getMaxItemId(actionApiUrl, namespacesData) {
    const cacheKey = `maxItemId_${actionApiUrl}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    console.log(`Calculating max item ID for ${actionApiUrl}...`);
    if (!namespacesData) {
      console.warn('Namespaces data not provided to getMaxItemId. Cannot determine item namespace.');
      return null;
    }
    let itemNamespaceId = null;
    for (const nsId in namespacesData) {
      if (namespacesData[nsId].defaultcontentmodel === 'wikibase-item') {
        itemNamespaceId = parseInt(nsId, 10);
        break;
      }
    }

    if (itemNamespaceId === null) {
      console.warn(`Could not find a Wikibase item namespace for ${actionApiUrl}.`);
      this.cache.set(cacheKey, null);
      return null;
    }
    console.log(`Found item namespace ID: ${itemNamespaceId} for ${actionApiUrl}.`);
    
    try {
      // Using the imported actionAPIgetMaxEntityIdInt.
      const maxId = await actionAPIgetMaxEntityIdInt(actionApiUrl, itemNamespaceId);
      this.cache.set(cacheKey, maxId);
      if (maxId !== null) {
        console.log(`Max item ID for ${actionApiUrl}: ${maxId}`);
      } else {
        console.warn(`Max item ID for ${actionApiUrl} could not be determined.`);
      }
      return maxId;
    } catch (error) {
      console.error(`Error getting max item ID for ${actionApiUrl}:`, error.message);
      this.cache.set(cacheKey, null);
      return null;
    }
  }
