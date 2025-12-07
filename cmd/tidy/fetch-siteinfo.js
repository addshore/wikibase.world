/**
 * Fetch Siteinfo - Load MediaWiki siteinfo for all wikis
 * 
 * This script fetches siteinfo from each wiki's API and updates:
 * - PHP version (P68)
 * - Database type (P69)
 * - Database version (P70)
 * - Site statistics (P59-P62)
 * 
 * Usage:
 *   node cmd/tidy/fetch-siteinfo.js [filter]
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc } from '../../src/fetch.js';
import { world } from '../../src/world.js';
import { queues, HEADERS } from '../../src/general.js';
import process from 'process';

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running with filter: ${scriptFilter}`);
}

// Statistics
const stats = {
    total: 0,
    success: 0,
    noApi: 0,
    failed: 0,
    updated: {
        phpVersion: 0,
        dbType: 0,
        dbVersion: 0,
        statistics: 0,
    },
};

/**
 * Extract action API from wiki's main page (via wikibase.world P1)
 */
async function getActionApi(wiki) {
    // First try to get from existing claims
    const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
        .then(res => res?.json() || { entities: {} });
    
    if (!entities?.[wiki.item]) return null;
    
    wiki.entity = entities[wiki.item];
    wiki.simpleClaims = simplifyClaims(wiki.entity.claims);
    
    // Try P6 (action API) first
    if (wiki.simpleClaims.P6?.[0]) {
        return wiki.simpleClaims.P6[0];
    }
    
    // Infer from site URL
    const siteUrl = wiki.site.replace(/\/$/, '');
    return `${siteUrl}/w/api.php`;
}

/**
 * Fetch siteinfo from wiki
 */
async function fetchSiteinfo(actionApi) {
    const url = `${actionApi}?action=query&meta=siteinfo&siprop=general|statistics&format=json`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response) return null;
        const data = await response.json();
        return data?.query;
    } catch {
        return null;
    }
}

/**
 * Process a single wiki
 */
async function processWiki(wiki) {
    try {
        const actionApi = await getActionApi(wiki);
        if (!actionApi) {
            stats.noApi++;
            return;
        }
        
        const siteinfo = await fetchSiteinfo(actionApi);
        if (!siteinfo) {
            console.log(`   ❌ ${wiki.site}: Failed to fetch siteinfo`);
            stats.failed++;
            return;
        }
        
        const general = siteinfo.general || {};
        const statistics = siteinfo.statistics || {};
        
        let updates = [];
        
        // PHP version (P68)
        if (general.phpversion) {
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P68', value: general.phpversion },
                { summary: `Set [[Property:P68]] to ${general.phpversion} from siteinfo` }
            );
            updates.push(`PHP ${general.phpversion}`);
            stats.updated.phpVersion++;
        }
        
        // Database type (P69)
        if (general.dbtype) {
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P69', value: general.dbtype },
                { summary: `Set [[Property:P69]] to ${general.dbtype} from siteinfo` }
            );
            updates.push(`DB: ${general.dbtype}`);
            stats.updated.dbType++;
        }
        
        // Database version (P70)
        if (general.dbversion) {
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P70', value: general.dbversion },
                { summary: `Set [[Property:P70]] to ${general.dbversion} from siteinfo` }
            );
            updates.push(`DB v${general.dbversion}`);
            stats.updated.dbVersion++;
        }
        
        // Statistics - only update if significantly different (log scale)
        // These are quantity types, so we need to pass {amount: "+N", unit: "1"}
        const shouldUpdateNumeric = (current, newVal) => {
            if (!current) return true;
            if (newVal === 0) return current !== 0;
            // Extract amount if it's a quantity object
            const currentAmount = typeof current === 'object' ? parseInt(current.amount, 10) : current;
            const ratio = Math.abs(Math.log10(newVal) - Math.log10(currentAmount));
            return ratio > 0.1; // ~25% change
        };
        
        if (statistics.edits !== undefined) {
            const current = wiki.simpleClaims?.P59?.[0];
            if (shouldUpdateNumeric(current, statistics.edits)) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P59', value: { amount: `+${statistics.edits}`, unit: '1' } },
                    { summary: `Update [[Property:P59]] to ${statistics.edits} from siteinfo` }
                );
                stats.updated.statistics++;
            }
        }
        
        if (statistics.users !== undefined) {
            const current = wiki.simpleClaims?.P60?.[0];
            if (shouldUpdateNumeric(current, statistics.users)) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P60', value: { amount: `+${statistics.users}`, unit: '1' } },
                    { summary: `Update [[Property:P60]] to ${statistics.users} from siteinfo` }
                );
                stats.updated.statistics++;
            }
        }
        
        if (statistics.activeusers !== undefined) {
            const current = wiki.simpleClaims?.P61?.[0];
            if (shouldUpdateNumeric(current, statistics.activeusers)) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P61', value: { amount: `+${statistics.activeusers}`, unit: '1' } },
                    { summary: `Update [[Property:P61]] to ${statistics.activeusers} from siteinfo` }
                );
                stats.updated.statistics++;
            }
        }
        
        if (statistics.pages !== undefined) {
            const current = wiki.simpleClaims?.P62?.[0];
            if (shouldUpdateNumeric(current, statistics.pages)) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P62', value: { amount: `+${statistics.pages}`, unit: '1' } },
                    { summary: `Update [[Property:P62]] to ${statistics.pages} from siteinfo` }
                );
                stats.updated.statistics++;
            }
        }
        
        console.log(`   ✅ ${wiki.site}: ${updates.join(', ') || 'fetched'}`);
        stats.success++;
    } catch (e) {
        console.log(`   ❌ ${wiki.site}: ${e.message}`);
        stats.failed++;
    }
}

/**
 * Wait for all queues to be idle
 */
async function waitForQueues() {
    let lastSize = -1;
    let stableCount = 0;
    
    while (stableCount < 3) {
        const currentSize = queues.many.size + queues.many.pending + 
                           queues.four.size + queues.four.pending + 
                           queues.one.size + queues.one.pending;
        
        if (currentSize === 0 && lastSize === 0) {
            stableCount++;
        } else {
            stableCount = 0;
        }
        
        lastSize = currentSize;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

/**
 * Print statistics
 */
function printStats() {
    console.log('');
    console.log('📊 Statistics:');
    console.log(`   Total:         ${stats.total}`);
    console.log(`   Success:       ${stats.success}`);
    console.log(`   No API:        ${stats.noApi}`);
    console.log(`   Failed:        ${stats.failed}`);
    console.log(`   Updates:`);
    console.log(`     PHP version: ${stats.updated.phpVersion}`);
    console.log(`     DB type:     ${stats.updated.dbType}`);
    console.log(`     DB version:  ${stats.updated.dbVersion}`);
    console.log(`     Statistics:  ${stats.updated.statistics}`);
}

/**
 * Main
 */
async function main() {
    console.log('📊 Fetch Siteinfo - MediaWiki API Data');
    console.log('');
    
    console.log('🌍 Loading wikis from wikibase.world...');
    let wikis = await world.sparql.wikis();
    
    // Shuffle for randomness
    wikis.sort(() => Math.random() - 0.5);
    
    // Apply filter
    if (scriptFilter) {
        wikis = wikis.filter(w => w.site.includes(scriptFilter));
        console.log(`   Filtered to ${wikis.length} wikis`);
    }
    
    stats.total = wikis.length;
    console.log(`   Found ${wikis.length} wikis to process`);
    console.log('');
    
    // Queue all wiki processing
    for (const wiki of wikis) {
        queues.many.add(() => processWiki(wiki), { jobName: `siteinfo:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();
