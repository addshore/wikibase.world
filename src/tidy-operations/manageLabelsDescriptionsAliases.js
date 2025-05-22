// src/tidy-operations/manageLabelsDescriptionsAliases.js

/**
 * Proposes changes to labels, descriptions, and aliases for an entity.
 * Focuses on English ('en') language primarily.
 *
 * @param {object} context The context object from ContextProvider.
 * @returns {Promise<Array<object>>} Array of change proposal objects.
 */
export async function proposeLabelDescriptionAliasChanges(context) {
  const changes = [];
  const {
    title, // from <title> tag
    domain,
    metaDescription, // from <meta name="description">
    wikibaseWorldQid,
    wikibaseWorldEntity,
    url: siteUrl
  } = context;

  if (!wikibaseWorldQid || !wikibaseWorldEntity) {
    console.log(`[${siteUrl}] No wikibase.world entity data. Cannot manage labels/descriptions/aliases.`);
    return changes;
  }

  const lang = 'en'; // Focus on English

  // 1. Prepare potential labels
  let probablyGoodLabels = [];
  if (title) {
    probablyGoodLabels.push(title.trim());
  }
  if (domain) {
    probablyGoodLabels.push(domain.trim());
  }

  // Clean labels: remove "Main Page - ", filter out "wikibase-docker" variants, ensure uniqueness
  probablyGoodLabels = probablyGoodLabels
    .map(label => label.replace(/^Main Page - /i, '').replace(/ - Main Page$/i, '').trim())
    .filter(label => !label.toLowerCase().includes('wikibase-docker') && !label.toLowerCase().includes('main page'))
    .filter(label => label.length > 0);
  probablyGoodLabels = [...new Set(probablyGoodLabels)]; 
  console.log(`[${siteUrl}] Probably good labels (cleaned): ${JSON.stringify(probablyGoodLabels)}`);

  // 2. Analyze existing labels and aliases
  const currentLabels = wikibaseWorldEntity.labels || {};
  const currentAliases = wikibaseWorldEntity.aliases || {};
  const currentDescriptions = wikibaseWorldEntity.descriptions || {};

  const currentEnLabel = currentLabels[lang] ? currentLabels[lang].value : null;
  const currentEnAliases = currentAliases[lang] ? currentAliases[lang].map(a => a.value) : [];
  const allEnLabelsAndAliases = currentEnLabel ? [currentEnLabel, ...currentEnAliases] : [...currentEnAliases];

  // 3. Label management
  if (probablyGoodLabels.length > 0) {
    let bestLabel = probablyGoodLabels.find(l => l !== domain) || probablyGoodLabels[0]; // Prefer non-domain title

    if (!currentEnLabel) {
      changes.push({
        action: 'setLabel',
        entityId: wikibaseWorldQid,
        language: lang,
        value: bestLabel,
        summary: `Set 'en' label for ${siteUrl} to "${bestLabel}" from site title/domain.`
      });
      console.log(`[${siteUrl}] Proposing to SET 'en' label to "${bestLabel}".`);
      // Remove this new label from alias consideration if it was a candidate
      allEnLabelsAndAliases.push(bestLabel); // Assume it will be set
    } else if (currentEnLabel.toLowerCase() === domain.toLowerCase() && bestLabel.toLowerCase() !== domain.toLowerCase()) {
      // Current label is just the domain, and we found a better one (not the domain)
      changes.push({
        action: 'setLabel',
        entityId: wikibaseWorldQid,
        language: lang,
        value: bestLabel,
        summary: `Change 'en' label for ${siteUrl} from domain to "${bestLabel}" from site title.`
      });
      console.log(`[${siteUrl}] Proposing to CHANGE 'en' label from "${currentEnLabel}" to "${bestLabel}".`);
      // The old label (domain) might become an alias later if it's in probablyGoodLabels
      allEnLabelsAndAliases.push(bestLabel); // Assume it will be set
    }
  }

  // 4. Alias management
  // Add missing good labels as aliases
  for (const potentialAlias of probablyGoodLabels) {
    if (!allEnLabelsAndAliases.some(existing => existing.toLowerCase() === potentialAlias.toLowerCase())) {
      changes.push({
        action: 'addAlias',
        entityId: wikibaseWorldQid,
        language: lang,
        value: potentialAlias,
        summary: `Add 'en' alias "${potentialAlias}" for ${siteUrl} from site title/domain.`
      });
      console.log(`[${siteUrl}] Proposing to ADD 'en' alias "${potentialAlias}".`);
    }
  }

  // Remove problematic aliases (e.g., "Main Page - Wikibase")
  // The cleaning for probablyGoodLabels already handles "Main Page - ".
  // Here, we check existing aliases that might have been added before such cleaning.
  for (const existingAlias of currentEnAliases) {
    if (existingAlias.toLowerCase().startsWith('main page -') || existingAlias.toLowerCase().endsWith(' - main page')) {
      changes.push({
        action: 'removeAlias',
        entityId: wikibaseWorldQid,
        language: lang,
        value: existingAlias,
        summary: `Remove 'en' alias "${existingAlias}" for ${siteUrl} as it is problematic.`
      });
      console.log(`[${siteUrl}] Proposing to REMOVE 'en' alias "${existingAlias}".`);
    }
  }
  
  // 5. Description management
  const currentEnDescription = currentDescriptions[lang] ? currentDescriptions[lang].value : null;
  if (!currentEnDescription && metaDescription && metaDescription.trim().length > 0) {
    // Limit description length (Wikibase has a limit, often 250 characters)
    const trimmedDescription = metaDescription.trim().substring(0, 250);
    changes.push({
      action: 'setDescription',
      entityId: wikibaseWorldQid,
      language: lang,
      value: trimmedDescription,
      summary: `Set 'en' description for ${siteUrl} from meta tag.`
    });
    console.log(`[${siteUrl}] Proposing to SET 'en' description to "${trimmedDescription}".`);
  }

  return changes;
}
proposeLabelDescriptionAliasChanges.operationName = "ManageLabelsDescriptionsAliases";
