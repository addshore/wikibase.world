// src/tidy-operations/linkToOtherWikis.js

const worldLinksToWikibaseProperty = 'P55';
const worldLinkedFromWikibaseProperty = 'P56';

// Items to skip for adding outgoing links (e.g. wikibase.world itself, registry)
const skipOutgoingLinksFromItems = ['Q3', 'Q58'];


/**
 * Proposes P55 (links to Wikibase) and P56 (linked from Wikibase) claims
 * between the current wiki and other known wikis on wikibase.world.
 *
 * @param {object} context The context object from ContextProvider.
 * @returns {Promise<Array<object>>} Array of change proposal objects.
 */
export async function proposeLinkToOtherWikisChanges(context) {
  const changes = [];
  const {
    wikibaseWorldQid, // QID of the current wiki
    wikibaseWorldSimpleClaims, // Simple claims of the current wiki
    externalLinkDomains = [],
    formatterUrlPatternDomains = [],
    worldWikis = [], // List of all wikis: { item: 'QID', site: 'domain.com' }
    url: siteUrl
  } = context;

  if (!wikibaseWorldQid || !wikibaseWorldSimpleClaims) {
    console.log(`[${siteUrl}] No current wiki QID or claims data. Cannot propose P55/P56 links.`);
    return changes;
  }

  if (worldWikis.length === 0) {
    console.log(`[${siteUrl}] World wikis list is empty. Cannot determine links.`);
    return changes;
  }

  // Combine all unique domains the current wiki might link to
  const allLinkedDomains = [...new Set([...externalLinkDomains, ...formatterUrlPatternDomains])];
  if (allLinkedDomains.length === 0) {
    console.log(`[${siteUrl}] No external or formatter URL domains found for the current wiki. No P55/P56 links to propose.`);
    return changes;
  }
  console.log(`[${siteUrl}] Found ${allLinkedDomains.length} unique domains linked from the current wiki.`);

  // Create a map for quick domain to QID lookup for worldWikis
  const worldDomainToQidMap = new Map();
  worldWikis.forEach(wiki => {
    try {
      // Normalize domain from site URL if it includes protocol/path
      const domain = new URL(wiki.site).hostname;
      worldDomainToQidMap.set(domain, wiki.item);
    } catch (e) {
      // console.warn(`[${siteUrl}] Invalid site URL in worldWikis list: ${wiki.site}`);
    }
  });
  
  const knownLinkedWikisQids = [];
  for (const domain of allLinkedDomains) {
    if (worldDomainToQidMap.has(domain)) {
      const linkedQid = worldDomainToQidMap.get(domain);
      if (linkedQid !== wikibaseWorldQid) { // Don't link to self
        knownLinkedWikisQids.push(linkedQid);
      }
    }
  }
  
  if (knownLinkedWikisQids.length === 0) {
    console.log(`[${siteUrl}] None of the linked domains correspond to known wikis on wikibase.world.`);
    return changes;
  }
  console.log(`[${siteUrl}] Found ${knownLinkedWikisQids.length} known wikis linked from the current wiki: ${JSON.stringify(knownLinkedWikisQids)}`);

  // Get existing P55 claims to avoid duplicates
  const existingP55Values = wikibaseWorldSimpleClaims[worldLinksToWikibaseProperty] || [];

  for (const linkedQid of knownLinkedWikisQids) {
    // Propose: CurrentWikiQID -> P55 -> LinkedWikiQID
    if (!skipOutgoingLinksFromItems.includes(wikibaseWorldQid)) {
      if (!existingP55Values.includes(linkedQid)) {
        changes.push({
          action: 'createClaim', // Should be handled by claimEnsure in applyChanges
          entityId: wikibaseWorldQid,
          property: worldLinksToWikibaseProperty,
          value: linkedQid,
          summary: `Add link (P55) from ${siteUrl} (${wikibaseWorldQid}) to known Wikibase ${linkedQid}.`
        });
        console.log(`[${siteUrl}] Proposing: ${wikibaseWorldQid} -> P55 -> ${linkedQid}`);
      } else {
        console.log(`[${siteUrl}] Link ${wikibaseWorldQid} -> P55 -> ${linkedQid} already exists.`);
      }
    }

    // Propose: LinkedWikiQID -> P56 -> CurrentWikiQID
    // To check if this link already exists, we'd need claims of the *linkedQid*.
    // `claimEnsure` in `applyChanges` will handle this by fetching the linkedQid's claims before creating.
    // So, we don't need to check here, just propose.
    // However, we should avoid adding P56 to Q3 (wikibase.world) or Q58 (registry)
    if (!skipOutgoingLinksFromItems.includes(linkedQid)) {
        changes.push({
            action: 'createClaim', // Should be handled by claimEnsure
            entityId: linkedQid,
            property: worldLinkedFromWikibaseProperty,
            value: wikibaseWorldQid,
            summary: `Add reciprocal link (P56) from ${linkedQid} to ${siteUrl} (${wikibaseWorldQid}).`
        });
        console.log(`[${siteUrl}] Proposing: ${linkedQid} -> P56 -> ${wikibaseWorldQid}`);
    }
  }

  return changes;
}

proposeLinkToOtherWikisChanges.operationName = "LinkToOtherWikis";
