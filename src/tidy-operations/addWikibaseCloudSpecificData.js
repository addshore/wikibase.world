// src/tidy-operations/addWikibaseCloudSpecificData.js

const HOST_WIKIBASE_CLOUD = 'Q8';

// Properties
const P2_HOST = 'P2';
const P7_QUERY_SERVICE_UI = 'P7';
const P8_SPARQL_ENDPOINT = 'P8';
const P49_MAIN_PAGE_URL = 'P49';
const P37_WIKI_TOOLS_USED = 'P37';
const P12_SUPPORTED_ENTITY_TYPES = 'P12';
const P1_OFFICIAL_WEBSITE = 'P1'; // Used as qualifier for P37

// Tool QIDs
const TOOL_QUERY_SERVICE = 'Q285';
const TOOL_CRADLE = 'Q287';
const TOOL_QUICKSTATEMENTS = 'Q286';

// Entity Type QIDs
const ENTITY_ITEM = 'Q51';
const ENTITY_PROPERTY = 'Q52';


/**
 * Proposes claims specific to wikis hosted on Wikibase.cloud (Q8).
 *
 * @param {object} context The context object from ContextProvider.
 * @returns {Promise<Array<object>>} Array of change proposal objects.
 */
export async function proposeWikibaseCloudSpecificChanges(context) {
  const changes = [];
  const {
    domain,
    wikibaseWorldQid,
    wikibaseWorldSimpleClaims,
    url: siteUrl
  } = context;

  if (!wikibaseWorldQid || !wikibaseWorldSimpleClaims || !domain) {
    console.log(`[${siteUrl}] Missing QID, claims, or domain. Cannot propose Wikibase.cloud specific changes.`);
    return changes;
  }

  const hostClaims = wikibaseWorldSimpleClaims[P2_HOST] || [];
  if (!hostClaims.includes(HOST_WIKIBASE_CLOUD)) {
    // console.log(`[${siteUrl}] Not hosted on Wikibase.cloud (P2 is not Q8). Skipping Wikibase.cloud specific claims.`);
    return changes;
  }

  console.log(`[${siteUrl}] Wiki is hosted on Wikibase.cloud (Q8). Checking specific claims...`);
  const protocolledDomain = `https://${domain}`;

  // Helper to propose a claim if not already present with the specific value
  const ensureClaim = (property, value, qualifiers = null, summary = null) => {
    const existingValues = wikibaseWorldSimpleClaims[property] || [];
    // A more robust check might involve serializing qualifier values if they matter for uniqueness.
    // For now, just check the main value. claimEnsure in applyChanges should handle deeper checks.
    if (!existingValues.includes(value)) {
      changes.push({
        action: 'createClaim', // Relies on claimEnsure
        entityId: wikibaseWorldQid,
        property,
        value,
        qualifiers,
        summary: summary || `Add known Wikibase.cloud claim ${property}=${value} for ${siteUrl}.`
      });
      console.log(`[${siteUrl}] Proposing ADD for ${property}=${value}.`);
    } else {
      // console.log(`[${siteUrl}] Claim ${property}=${value} already exists.`);
    }
  };

  // P7 - Query Service UI
  ensureClaim(P7_QUERY_SERVICE_UI, `${protocolledDomain}/query`);
  // Check for alternative with trailing slash (seen in old script)
  if (!wikibaseWorldSimpleClaims[P7_QUERY_SERVICE_UI]?.includes(`${protocolledDomain}/query/`)) {
      // If only the non-slash version exists, this won't add. 
      // If neither exists, the one without slash is added.
      // If only slash version exists, this logic doesn't try to add non-slash.
      // This is slightly different from old script's "ensure P7 or P7/"
      // For simplicity, we ensure one specific format.
  }


  // P8 - SPARQL Endpoint
  ensureClaim(P8_SPARQL_ENDPOINT, `${protocolledDomain}/query/sparql`);

  // P49 - Main Page URL
  ensureClaim(P49_MAIN_PAGE_URL, `${protocolledDomain}/wiki/Main_Page`);

  // P37 - Wiki Tools Used
  ensureClaim(P37_WIKI_TOOLS_USED, TOOL_QUERY_SERVICE, { [P7_QUERY_SERVICE_UI]: `${protocolledDomain}/query`, [P8_SPARQL_ENDPOINT]: `${protocolledDomain}/query/sparql` }, `Add Query Service (Q285) tool for ${siteUrl}.`);
  ensureClaim(P37_WIKI_TOOLS_USED, TOOL_CRADLE, { [P1_OFFICIAL_WEBSITE]: `${protocolledDomain}/tools/cradle` }, `Add Cradle (Q287) tool for ${siteUrl}.`);
  ensureClaim(P37_WIKI_TOOLS_USED, TOOL_QUICKSTATEMENTS, { [P1_OFFICIAL_WEBSITE]: `${protocolledDomain}/tools/quickstatements` }, `Add QuickStatements (Q286) tool for ${siteUrl}.`);

  // P12 - Supported Entity Types
  ensureClaim(P12_SUPPORTED_ENTITY_TYPES, ENTITY_ITEM, null, `Add supported entity type Item (Q51) for ${siteUrl}.`);
  ensureClaim(P12_SUPPORTED_ENTITY_TYPES, ENTITY_PROPERTY, null, `Add supported entity type Property (Q52) for ${siteUrl}.`);

  return changes;
}

proposeWikibaseCloudSpecificChanges.operationName = "AddWikibaseCloudSpecificData";
