/**
 * Claim Helpers - Reusable utilities for managing claims on wikibase.world items
 * 
 * These helpers encapsulate common patterns for:
 * - Ensuring a claim exists (add if missing)
 * - Updating a claim if it differs
 * - Handling single-value properties with proper error logging
 * - Comparing numeric values with logarithmic thresholds
 */

import { world } from '../world.js';

/**
 * Check if a numeric value should be updated based on logarithmic difference
 * @param {number} oldValue - The current value
 * @param {number} newValue - The new value
 * @param {number} threshold - The log10 threshold (default 0.5 = ~3x change)
 * @returns {boolean} True if the value should be updated
 */
export function shouldUpdateNumericClaim(oldValue, newValue, threshold = 0.5) {
    if (oldValue === 0 || newValue === 0) {
        return oldValue !== newValue;
    }
    const logDifference = Math.abs(Math.log10(newValue) - Math.log10(oldValue));
    return logDifference >= threshold;
}

/**
 * Helper to ensure or update a single-value string claim
 * 
 * @param {Object} options
 * @param {Object} options.queue - The queue to add the work to
 * @param {Object} options.wiki - Wiki context with item and simpleClaims
 * @param {string} options.property - Property ID (e.g., 'P68')
 * @param {string} options.value - The value to ensure/update
 * @param {string} options.summaryAdd - Summary for adding the claim
 * @param {string} options.summaryUpdate - Summary template for updating (use {old} and {new} placeholders)
 * @param {Object} [options.qualifiers] - Optional qualifiers
 * @param {Object} [options.references] - Optional references
 */
export function ensureStringClaim({ queue, wiki, property, value, summaryAdd, summaryUpdate, qualifiers, references }) {
    if (!wiki.simpleClaims[property]) {
        const data = { id: wiki.item, property, value };
        if (qualifiers) data.qualifiers = qualifiers;
        if (references) data.references = references;
        world.queueWork.claimEnsure(queue, data, { summary: summaryAdd });
    } else if (wiki.simpleClaims[property].length > 1) {
        console.log(`❌ The item ${wiki.item} has more than 1 ${property} claim`);
    } else if (wiki.simpleClaims[property][0] !== value) {
        const summary = summaryUpdate
            .replace('{old}', wiki.simpleClaims[property][0])
            .replace('{new}', value);
        world.queueWork.claimUpdate(queue, {
            id: wiki.item,
            property,
            oldValue: wiki.simpleClaims[property][0],
            newValue: value
        }, { summary });
    }
    // If the value is the same, do nothing
}

/**
 * Helper to ensure or update a single-value numeric claim with logarithmic threshold
 * 
 * @param {Object} options
 * @param {Object} options.queue - The queue to add the work to
 * @param {Object} options.wiki - Wiki context with item and simpleClaims
 * @param {string} options.property - Property ID (e.g., 'P62')
 * @param {number} options.value - The numeric value to ensure/update
 * @param {string} options.summaryAdd - Summary for adding the claim
 * @param {string} options.summaryUpdate - Summary template for updating (use {old}, {new}, {delta} placeholders)
 * @param {number} [options.threshold=0.5] - Logarithmic threshold for updates
 */
export function ensureNumericClaim({ queue, wiki, property, value, summaryAdd, summaryUpdate, threshold = 0.5 }) {
    if (!wiki.simpleClaims[property]) {
        world.queueWork.claimEnsure(queue, { id: wiki.item, property, value }, { summary: summaryAdd });
    } else if (wiki.simpleClaims[property].length > 1) {
        console.log(`❌ The item ${wiki.item} has more than 1 ${property} claim`);
    } else if (shouldUpdateNumericClaim(wiki.simpleClaims[property][0], value, threshold)) {
        const delta = value - wiki.simpleClaims[property][0];
        const summary = summaryUpdate
            .replace('{old}', wiki.simpleClaims[property][0])
            .replace('{new}', value)
            .replace('{delta}', delta);
        world.queueWork.claimUpdate(queue, {
            id: wiki.item,
            property,
            oldValue: wiki.simpleClaims[property][0],
            newValue: value
        }, { summary });
    }
}

/**
 * Helper to ensure a claim exists (add if missing, don't update if present)
 * 
 * @param {Object} options
 * @param {Object} options.queue - The queue to add the work to
 * @param {Object} options.wiki - Wiki context with item and simpleClaims
 * @param {string} options.property - Property ID
 * @param {string|number} options.value - The value to ensure
 * @param {string} options.summary - Summary for adding the claim
 * @param {Object} [options.qualifiers] - Optional qualifiers
 * @param {Object} [options.references] - Optional references
 */
export function ensureClaimExists({ queue, wiki, property, value, summary, qualifiers, references }) {
    if (!wiki.simpleClaims[property]) {
        const data = { id: wiki.item, property, value };
        if (qualifiers) data.qualifiers = qualifiers;
        if (references) data.references = references;
        world.queueWork.claimEnsure(queue, data, { summary });
    }
}

/**
 * Helper to ensure a multi-value claim includes a specific value
 * 
 * @param {Object} options
 * @param {Object} options.queue - The queue to add the work to
 * @param {Object} options.wiki - Wiki context with item and simpleClaims
 * @param {string} options.property - Property ID
 * @param {string|number} options.value - The value to ensure is present
 * @param {string} options.summary - Summary for adding the claim
 * @param {Object} [options.qualifiers] - Optional qualifiers
 */
export function ensureClaimIncludes({ queue, wiki, property, value, summary, qualifiers }) {
    if (!wiki.simpleClaims[property] || !wiki.simpleClaims[property].includes(value)) {
        const data = { id: wiki.item, property, value };
        if (qualifiers) data.qualifiers = qualifiers;
        world.queueWork.claimEnsure(queue, data, { summary });
    }
}

/**
 * Create a standardized processor function that handles a specific property from siteinfo
 * 
 * @param {Object} config
 * @param {string} config.property - Property ID (e.g., 'P68')
 * @param {string} config.path - Dot-notation path in siteinfo (e.g., 'general.phpversion')
 * @param {string} config.name - Human-readable name (e.g., 'PHP version')
 * @param {string} config.source - Source description (e.g., 'siteinfo')
 * @param {'string'|'numeric'} [config.type='string'] - Value type
 * @returns {Function} Processor function
 */
export function createSiteInfoPropertyProcessor({ property, path, name, source, type = 'string' }) {
    return function processor({ wiki, siteinfo, queue }) {
        // Navigate the path to get the value
        const parts = path.split('.');
        let value = siteinfo;
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return; // Path doesn't exist in siteinfo
            }
        }
        
        if (value === undefined || value === null) {
            return;
        }

        if (type === 'numeric') {
            ensureNumericClaim({
                queue,
                wiki,
                property,
                value: Number(value),
                summaryAdd: `Add [[Property:${property}]] claim for ${value} based on ${name} from ${source}`,
                summaryUpdate: `Update [[Property:${property}]] claim from {old} to {new} (delta: {delta}) based on ${name} from ${source}`
            });
        } else {
            ensureStringClaim({
                queue,
                wiki,
                property,
                value: String(value),
                summaryAdd: `Add [[Property:${property}]] claim for ${value} based on ${name} from ${source}`,
                summaryUpdate: `Update [[Property:${property}]] claim from {old} to {new} based on ${name} from ${source}`
            });
        }
    };
}
