/**
 * Last Edit Processor - Updates the month of last edit (P73)
 *
 * Subscribes to: wiki.data.last-edit
 * Property: P73 (month of last edit)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

const PROPERTY = 'P73';
const PROPERTY_NAME = 'month of last edit';

/**
 * Process last edit timestamp
 * @param {Object} context - { wiki, lastEdit, queues }
 */
export function process({ wiki, lastEdit, queues }) {
    if (!lastEdit?.timestamp || !lastEdit?.apiUrl) return;

    const { timestamp, apiUrl } = lastEdit;

    // Extract year and month, e.g., 2024-03-21T12:34:56Z -> 2024-03
    const dateParts = timestamp.split('T')[0].split('-');
    const year = dateParts[0];
    const month = dateParts[1];
    const yearMonth = `${year}-${month}`;
    const yearMonthDay = `${yearMonth}-01`; // Wikibase time needs a day

    const today = new Date().toISOString().split('T')[0];

    // precision 10 is month
    const desiredValue = {
        time: `+${yearMonthDay}T00:00:00Z`,
        timezone: 0,
        before: 0,
        after: 0,
        precision: 10,
        calendarmodel: 'http://www.wikidata.org/entity/Q1985727'
    };

    // If no P73 claim, add one with references
    if (!wiki.simpleClaims[PROPERTY]) {
        world.queueWork.claimEnsure(
            queues.one,
            {
                id: wiki.item,
                property: PROPERTY,
                value: desiredValue,
                references: { P21: apiUrl, P22: today }
            },
            { summary: `Add [[Property:${PROPERTY}]] claim for ${yearMonth} based on the latest edit or log entry of the wiki` }
        );
        return;
    }

    // If there's a P73 claim, check if it needs update
    if (wiki.simpleClaims[PROPERTY].length === 1) {
        const existingFullValue = wiki.entity.claims[PROPERTY][0].mainsnak.datavalue.value;
        const existingTime = existingFullValue.time; // e.g. +2024-03-01T00:00:00Z
        const existingPrecision = existingFullValue.precision;

        const existingYearMonth = existingTime.substring(1, 8); // 2024-03

        if (existingYearMonth !== yearMonth || existingPrecision !== 10) {
             world.queueWork.claimEnsure(
                queues.one,
                {
                    id: wiki.item,
                    property: PROPERTY,
                    value: desiredValue,
                    references: { P21: apiUrl, P22: today }
                },
                { summary: `Update [[Property:${PROPERTY}]] claim to ${yearMonth} based on the latest edit or log entry of the wiki` }
            );
        }
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_LAST_EDIT, 'processor:last-edit', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };
