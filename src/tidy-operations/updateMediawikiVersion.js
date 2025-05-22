// src/tidy-operations/updateMediawikiVersion.js

/**
 * Proposes changes to the MediaWiki version (P57) claim based on context.
 *
 * @param {object} context The context object provided by ContextProvider.
 *                         Expected properties:
 *                         - mwVersion (string|null): MediaWiki version from generator tag.
 *                         - wikibaseWorldQid (string|null): QID of the wiki on wikibase.world.
 *                         - wikibaseWorldEntity (object|null): Full entity data from wikibase.world.
 *                         - wikibaseWorldSimpleClaims (object|null): Simplified claims from wikibase.world.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of change proposal objects.
 */
export async function proposeMediawikiVersionChanges(context) {
  const changes = [];
  const {
    mwVersion,
    wikibaseWorldQid,
    wikibaseWorldSimpleClaims,
    url: siteUrl // for logging/summary
  } = context;

  if (!mwVersion) {
    console.log(`[${siteUrl}] No MediaWiki version found in context (meta generator tag). Skipping P57 update.`);
    return changes;
  }

  if (!wikibaseWorldQid || !wikibaseWorldSimpleClaims) {
    console.log(`[${siteUrl}] No wikibase.world entity data found in context. Cannot propose P57 changes.`);
    // Potentially, if the wiki is new, we might propose adding P57 to a new item.
    // For now, we only operate on existing, known items.
    return changes;
  }

  const propertyP57 = 'P57';
  const existingP57Claims = wikibaseWorldSimpleClaims[propertyP57]; // This will be an array of values or undefined

  if (!existingP57Claims || existingP57Claims.length === 0) {
    // No P57 claim exists, propose adding it
    changes.push({
      action: 'createClaim', // Corresponds to world.queueWork.claimCreate or claimEnsure
      entityId: wikibaseWorldQid,
      property: propertyP57,
      value: mwVersion,
      summary: `Add MediaWiki version ${mwVersion} (P57) based on generator tag for ${siteUrl}.`
    });
    console.log(`[${siteUrl}] Proposing to ADD P57 claim with value ${mwVersion}.`);
  } else {
    // P57 claim(s) exist. For simplicity, we'll consider the first one.
    // Real-world scenarios might need to handle multiple P57 claims if that's possible.
    const currentP57Value = existingP57Claims[0];
    if (currentP57Value !== mwVersion) {
      // Value is different, propose updating it
      // Note: world.edit.claim.update requires the claim GUID.
      // The current `world.queueWork.claimUpdate` in `tidy-world.js` takes { id, property, oldValue, newValue }.
      // We need to ensure our change application logic can handle this, or fetch the claim GUID.
      // For now, let's assume a simplified update that `world.queueWork.claimUpdate` (if it's adapted or if claimEnsure handles updates) can process.
      // Or, more robustly, we'd need the GUID of the specific claim to update.
      // The old `tidy-world.js` used a simplified `claimUpdate` that might rely on `oldValue` to find the claim.
      // Let's stick to the `oldValue`/`newValue` for now, as per existing patterns.
      
      // We should also check if there are multiple P57 values and log a warning if so.
      if (existingP57Claims.length > 1) {
          console.warn(`[${siteUrl}] Multiple P57 (MediaWiki version) claims found. Proposing update for the first one: ${currentP57Value}.`);
      }

      changes.push({
        action: 'updateClaim', // Corresponds to world.queueWork.claimUpdate
        entityId: wikibaseWorldQid,
        property: propertyP57,
        oldValue: currentP57Value, // Important for the update logic to find the correct claim if no GUID is used
        newValue: mwVersion,
        summary: `Update MediaWiki version (P57) from ${currentP57Value} to ${mwVersion} based on generator tag for ${siteUrl}.`
      });
      console.log(`[${siteUrl}] Proposing to UPDATE P57 claim from ${currentP57Value} to ${mwVersion}.`);
    } else {
      console.log(`[${siteUrl}] MediaWiki version (P57) is already up-to-date (${mwVersion}). No change needed.`);
    }
  }

  return changes;
}

// Optional: Add a 'name' property for easier identification in logs, etc.
proposeMediawikiVersionChanges.operationName = "UpdateMediawikiVersion";
