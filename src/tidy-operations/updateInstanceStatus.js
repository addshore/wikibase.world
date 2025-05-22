// src/tidy-operations/updateInstanceStatus.js

/**
 * Proposes changes to the instance status (P13) claim based on context.
 *
 * @param {object} context The context object provided by ContextProvider.
 *                         Expected properties:
 *                         - mainPageHtml (string|null): HTML content of the main page.
 *                         - error (string|null): Error message if HTML fetch failed.
 *                         - wikibaseWorldQid (string|null): QID of the wiki on wikibase.world.
 *                         - wikibaseWorldSimpleClaims (object|null): Simplified claims from wikibase.world.
 *                         - url (string): The URL of the Wikibase being tidied (for logging).
 * @returns {Promise<Array<object>>} A promise that resolves to an array of change proposal objects.
 */
export async function proposeInstanceStatusChanges(context) {
  const changes = [];
  const {
    mainPageHtml,
    error: contextError, // Renaming to avoid conflict with Error object
    wikibaseWorldQid,
    wikibaseWorldSimpleClaims,
    url: siteUrl
  } = context;

  if (!wikibaseWorldQid || !wikibaseWorldSimpleClaims) {
    console.log(`[${siteUrl}] No wikibase.world entity data found in context. Cannot propose P13 changes.`);
    return changes;
  }

  const propertyP13 = 'P13';
  const onlineStatusQid = 'Q54'; // online
  const indefinitelyOfflineQid = 'Q72'; // indefinitely offline
  // const permanentlyOfflineQid = 'Q57'; // permanently offline - might be too strong for a script to decide

  let determinedStatusQid = null;

  if (contextError && contextError.includes('Failed to get main page HTML')) {
    // If there was an error fetching main page HTML, consider it offline.
    determinedStatusQid = indefinitelyOfflineQid;
    console.log(`[${siteUrl}] Main page HTML fetch failed. Determining status as Indefinitely Offline (Q72). Error: ${contextError}`);
  } else if (mainPageHtml && mainPageHtml.includes('content="MediaWiki')) {
    // If HTML is present and indicates MediaWiki, consider it online.
    determinedStatusQid = onlineStatusQid;
    console.log(`[${siteUrl}] Main page HTML indicates MediaWiki. Determining status as Online (Q54).`);
  } else if (mainPageHtml) {
    // HTML is present but doesn't look like MediaWiki. This is ambiguous.
    // Could be an error page, a non-MediaWiki site, etc.
    // For now, let's not change P13 if we get HTML but it's not clearly MediaWiki.
    // Alternatively, this could also be considered 'indefinitely offline' or a special status.
    console.log(`[${siteUrl}] Main page HTML fetched but does not appear to be a MediaWiki page. No P13 change proposed based on this.`);
    return changes;
  } else {
    // No HTML and no specific fetch error state noted for HTML (should be covered by contextError)
    // This case might be redundant if contextError is always set on fetch failure.
    console.log(`[${siteUrl}] No main page HTML and no specific fetch error. Ambiguous state for P13. No change proposed.`);
    return changes;
  }

  if (!determinedStatusQid) {
    // Should not happen if logic above is complete.
    console.log(`[${siteUrl}] Could not determine a P13 status. No change proposed.`);
    return changes;
  }

  const existingP13Claims = wikibaseWorldSimpleClaims[propertyP13];
  const currentP13Value = existingP13Claims ? existingP13Claims[0] : null; // Assuming P13 is not multi-valued normally

  if (existingP13Claims && existingP13Claims.length > 1) {
    console.warn(`[${siteUrl}] Multiple P13 (Instance Status) claims found. Considering the first one: ${currentP13Value}.`);
  }
  
  if (currentP13Value === determinedStatusQid) {
    console.log(`[${siteUrl}] Instance status (P13) is already ${determinedStatusQid}. No change needed.`);
  } else {
    if (currentP13Value) {
      // Existing P13 claim is different, propose update
      changes.push({
        action: 'updateClaim',
        entityId: wikibaseWorldQid,
        property: propertyP13,
        oldValue: currentP13Value,
        newValue: determinedStatusQid,
        summary: `Update instance status (P13) for ${siteUrl} from ${currentP13Value} to ${determinedStatusQid}.`
      });
      console.log(`[${siteUrl}] Proposing to UPDATE P13 claim from ${currentP13Value} to ${determinedStatusQid}.`);
    } else {
      // No P13 claim exists, propose adding it
      changes.push({
        action: 'createClaim',
        entityId: wikibaseWorldQid,
        property: propertyP13,
        value: determinedStatusQid,
        summary: `Add instance status (P13) for ${siteUrl} as ${determinedStatusQid}.`
      });
      console.log(`[${siteUrl}] Proposing to ADD P13 claim with value ${determinedStatusQid}.`);
    }
  }

  return changes;
}

proposeInstanceStatusChanges.operationName = "UpdateInstanceStatus";
