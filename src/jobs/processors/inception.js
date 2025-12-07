/**
 * Inception Date Processor - Updates inception date (P5) from first log entry
 * 
 * Subscribes to: wiki.data.inception
 * Property: P5 (inception date)
 */

import { eventBus, Events } from '../../events/bus.js';
import { world } from '../../world.js';

const PROPERTY = 'P5';
const PROPERTY_NAME = 'inception date';

/**
 * Process inception date
 * @param {Object} context - { wiki, inception, queues }
 */
export function process({ wiki, inception, queues }) {
    if (!inception?.date || !inception?.apiUrl) return;
    
    const { date: inceptionDate, apiUrl: logApiUrl } = inception;
    const today = new Date().toISOString().split('T')[0];
    
    // If no P5 claim, add one with references
    if (!wiki.simpleClaims.P5) {
        world.queueWork.claimEnsure(
            queues.one,
            { 
                id: wiki.item, 
                property: PROPERTY, 
                value: inceptionDate, 
                references: { P21: logApiUrl, P22: today } 
            },
            { summary: `Add [[Property:${PROPERTY}]] claim for ${inceptionDate} based on the first log entry of the wiki` }
        );
        return;
    }
    
    // If there's a P5 claim with same value but no reference, add the reference
    if (wiki.simpleClaims.P5.length === 1) {
        const existingDate = wiki.simpleClaims.P5[0]?.split?.('T')?.[0] || wiki.simpleClaims.P5[0];
        
        if (existingDate === inceptionDate && wiki.entity?.claims?.P5?.[0]?.references === undefined) {
            const guid = wiki.entity.claims.P5[0].id;
            world.queueWork.referenceSet(
                queues.one,
                { guid, snaks: { P21: logApiUrl, P22: today } },
                { summary: `Add references to [[Property:${PROPERTY}]] claim for ${inceptionDate} based on the first log entry of the wiki` }
            );
        }
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_INCEPTION, 'processor:inception', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };
