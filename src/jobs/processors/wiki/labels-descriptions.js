/**
 * Labels and Descriptions Processor - Manages wiki labels, aliases, and descriptions
 * 
 * Subscribes to: wiki.context-ready
 * Properties:
 *   - Labels (en)
 *   - Aliases (en)
 *   - Description (en)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

/**
 * Clean and prepare label candidates
 * @param {string[]} labels - Raw label candidates
 * @returns {string[]} Cleaned labels
 */
function cleanLabels(labels) {
    return labels
        .map(label => label.replace('Main Page - ', ''))
        .filter(label => !label.includes('Main Page'))
        .filter(label => !label.includes('wikibase-docker'))
        .filter(label => label !== '')
        .filter((label, index, self) => self.indexOf(label) === index); // unique
}

/**
 * Process labels, aliases and description for wiki
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    // Only process English wikis for now
    if (wiki.language !== 'en') return;
    
    let probablyGoodLabels = [];
    if (wiki.title) {
        probablyGoodLabels.push(wiki.title);
    }
    probablyGoodLabels.push(wiki.domain);
    probablyGoodLabels = cleanLabels(probablyGoodLabels);
    
    // Figure out current state
    let allEnLabelsAndAliases = [];
    let enLabelIsDomain = false;
    
    if (wiki.entity?.labels?.en) {
        allEnLabelsAndAliases.push(wiki.entity.labels.en.value);
        if (wiki.entity.labels.en.value === wiki.domain) {
            enLabelIsDomain = true;
        }
    }
    
    if (wiki.entity?.aliases?.en) {
        wiki.entity.aliases.en.forEach(alias => {
            allEnLabelsAndAliases.push(alias.value);
        });
    }
    
    // Remove bad aliases (starting with "Main Page - ")
    allEnLabelsAndAliases.forEach(alias => {
        if (alias.startsWith('Main Page - ')) {
            world.queueWork.aliasRemove(
                queues.one,
                { id: wiki.item, language: 'en', value: alias },
                { summary: `Remove en alias "Main Page - " as its a bad alias` }
            );
        }
    });
    
    // Find missing labels
    let missingLabels = probablyGoodLabels.filter(
        label => !allEnLabelsAndAliases.includes(label)
    );
    
    if (missingLabels.length > 0) {
        // If label is domain, swap it for better label
        if (enLabelIsDomain) {
            wiki.entity.labels.en = undefined;
            missingLabels.push(wiki.domain);
        }
        
        // TODO: Enable after more testing
        // Set label if missing
        // if (!wiki.entity?.labels?.en) {
        //     world.queueWork.labelSet(
        //         queues.one,
        //         { id: wiki.item, language: 'en', value: missingLabels[0] },
        //         { summary: `Add en label from known information` }
        //     );
        //     missingLabels.shift();
        // }
        
        // TODO: Enable after more testing
        // Add remaining as aliases
        // for (const missingLabel of missingLabels) {
        //     world.queueWork.aliasAdd(
        //         queues.one,
        //         { id: wiki.item, language: 'en', value: missingLabel },
        //         { summary: `Add en alias from known information` }
        //     );
        // }
    }
    
    // Set description from meta description
    if (wiki.metaDescription && !wiki.entity?.descriptions?.en) {
        world.queueWork.descriptionSet(
            queues.one,
            { id: wiki.item, language: 'en', value: wiki.metaDescription },
            { summary: `Add en description from Main Page HTML` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:labels-descriptions', process);
}

export default { register, process, cleanLabels };
