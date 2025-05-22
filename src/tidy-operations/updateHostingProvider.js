// src/tidy-operations/updateHostingProvider.js
import { hasHostedByProfessionalWikiLogo } from '../site.js'; // Corrected path

// Known reverse DNS patterns - these might need updating or a more robust checking mechanism
const REVERSE_WBWIKI_PRO = "server-108-138-217-36.lhr61.r.cloudfront.net"; // Example for WBWiki.PRO
const REVERSE_WIKITIDE = "cp37.wikitide.net"; // Example for Wikitide/Miraheze
// It's often better to rely on multiple signals or more specific rDNS checks if possible.

// Host QIDs
const HOST_WIKIBASE_CLOUD = 'Q8';
const HOST_THE_WIKIBASE_CONSULTANCY = 'Q7'; // For .wikibase.wiki / WBWiki.PRO
const HOST_MIRAHEZE = 'Q118';
const HOST_WIKIMEDIA_CLOUD_SERVICES = 'Q6'; // For .wmflabs.org / .toolforge.org etc.

/**
 * Proposes changes to the hosting provider (P2) claim.
 *
 * @param {object} context The context object from ContextProvider.
 *                         Expected: domain, reverseDNS, mainPageHtml, url,
 *                                   wikibaseWorldQid, wikibaseWorldSimpleClaims.
 * @returns {Promise<Array<object>>} Array of change proposal objects.
 */
export async function proposeHostingProviderChanges(context) {
  const changes = [];
  const {
    domain,
    reverseDNS = [], // Ensure default to empty array if not present
    mainPageHtml,
    url: siteUrl,    // URL of the wiki itself
    wikibaseWorldQid,
    wikibaseWorldSimpleClaims
  } = context;

  if (!wikibaseWorldQid || !wikibaseWorldSimpleClaims) {
    console.log(`[${siteUrl}] No wikibase.world entity data. Cannot propose P2 changes.`);
    return changes;
  }

  let determinedHostQid = null;
  let reason = '';

  // Check domain suffixes first
  if (domain.endsWith('.wikibase.cloud')) {
    determinedHostQid = HOST_WIKIBASE_CLOUD;
    reason = 'domain suffix .wikibase.cloud';
  } else if (domain.endsWith('.wikibase.wiki')) { // WBWiki.PRO often uses this
    determinedHostQid = HOST_THE_WIKIBASE_CONSULTANCY;
    reason = 'domain suffix .wikibase.wiki';
  } else if (domain.endsWith('.miraheze.org')) {
    determinedHostQid = HOST_MIRAHEZE;
    reason = 'domain suffix .miraheze.org';
  } else if (domain.endsWith('.wmflabs.org') || domain.endsWith('.toolforge.org')) { // Wikimedia hosting
    determinedHostQid = HOST_WIKIMEDIA_CLOUD_SERVICES;
    reason = `domain suffix ${domain.endsWith('.wmflabs.org') ? '.wmflabs.org' : '.toolforge.org'}`;
  }

  // Reverse DNS checks (can augment or override domain checks if more specific)
  // Ensure reverseDNS is an array before calling includes.
  if (Array.isArray(reverseDNS)) {
      if (reverseDNS.includes(REVERSE_WIKITIDE)) {
        determinedHostQid = HOST_MIRAHEZE; // Wikitide is Miraheze
        reason = 'Reverse DNS match for Wikitide/Miraheze';
      }
      // Add other rDNS checks here, e.g. for wikibase.cloud if reliable patterns exist beyond domain.
      // For WBWiki.PRO, the old script had REVERSE_WBWIKI_PRO.
      if (reverseDNS.includes(REVERSE_WBWIKI_PRO) && determinedHostQid !== HOST_THE_WIKIBASE_CONSULTANCY) {
         // If domain check didn't catch it, rDNS can.
         // Or, if domain was .wikibase.wiki, this confirms.
        determinedHostQid = HOST_THE_WIKIBASE_CONSULTANCY;
        reason = 'Reverse DNS match for WBWiki.PRO';
      }
  }


  // Check for ProfessionalWiki logo (WBWiki.PRO / The Wikibase Consultancy)
  // This is a strong indicator.
  if (mainPageHtml) {
      try {
        if (await hasHostedByProfessionalWikiLogo(siteUrl, mainPageHtml)) {
            determinedHostQid = HOST_THE_WIKIBASE_CONSULTANCY;
            reason = 'presence of HostedByProfessionalWiki.png logo';
        }
      } catch(e) {
          console.warn(`[${siteUrl}] Error checking for ProfessionalWikiLogo: ${e.message}`);
      }
  }
  
  if (!determinedHostQid) {
    console.log(`[${siteUrl}] Could not determine hosting provider (P2). No change proposed.`);
    return changes;
  }
  console.log(`[${siteUrl}] Determined hosting provider (P2) as ${determinedHostQid} based on ${reason}.`);

  const propertyP2 = 'P2';
  const existingP2Claims = wikibaseWorldSimpleClaims[propertyP2];
  const currentP2Value = existingP2Claims ? existingP2Claims[0] : null;

  if (existingP2Claims && existingP2Claims.length > 1) {
    console.warn(`[${siteUrl}] Multiple P2 (Hosting Provider) claims found. Considering the first one: ${currentP2Value}.`);
  }

  if (currentP2Value === determinedHostQid) {
    console.log(`[${siteUrl}] Hosting provider (P2) is already ${determinedHostQid}. No change needed.`);
  } else {
    if (currentP2Value) {
      changes.push({
        action: 'updateClaim',
        entityId: wikibaseWorldQid,
        property: propertyP2,
        oldValue: currentP2Value,
        newValue: determinedHostQid,
        summary: `Update hosting provider (P2) for ${siteUrl} to ${determinedHostQid} based on ${reason}.`
      });
      console.log(`[${siteUrl}] Proposing to UPDATE P2 claim from ${currentP2Value} to ${determinedHostQid}.`);
    } else {
      changes.push({
        action: 'createClaim',
        entityId: wikibaseWorldQid,
        property: propertyP2,
        value: determinedHostQid,
        summary: `Add hosting provider (P2) for ${siteUrl} as ${determinedHostQid} based on ${reason}.`
      });
      console.log(`[${siteUrl}] Proposing to ADD P2 claim with value ${determinedHostQid}.`);
    }
  }
  return changes;
}

proposeHostingProviderChanges.operationName = "UpdateHostingProvider";
