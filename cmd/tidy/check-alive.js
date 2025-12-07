/**
 * Check Alive - Verify wikis are online and responding
 * 
 * This script checks if wikis in wikibase.world are still alive by:
 * - Fetching the main page
 * - Following redirects
 * - Verifying it's still MediaWiki
 * - Extracting MW version from meta generator
 * - Setting activity status (P13)
 * 
 * Usage:
 *   node cmd/tidy/check-alive.js [filter]
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc, fetchc } from '../../src/fetch.js';
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
    alive: 0,
    dead: 0,
    redirected: 0,
    notMediaWiki: 0,
    failed: 0,
    mwVersionUpdated: 0,
};

/**
 * Extract MW version from response text
 */
function extractMwVersion(responseText) {
    const genMatch = responseText.match(/<meta name="generator" content="MediaWiki (.+?)"/);
    return genMatch ? genMatch[1] : null;
}

/**
 * Check if response is MediaWiki
 */
function isMediaWiki(responseText) {
    return responseText.includes('content="MediaWiki');
}

/**
 * Process a single wiki
 */
async function processWiki(wiki) {
    try {
        const response = await fetchc(wiki.site, { headers: HEADERS });
        const responseText = await response?.text();
        
        if (!response || !responseText) {
            console.log(`   ❌ ${wiki.site}: No response`);
            stats.dead++;
            return;
        }
        
        const finalUrl = response.url;
        const finalDomain = new URL(finalUrl).hostname;
        const originalDomain = new URL(wiki.site).hostname;
        
        // Check for domain redirect
        if (finalDomain !== originalDomain) {
            console.log(`   🔀 ${wiki.site} → ${finalUrl}`);
            stats.redirected++;
            return;
        }
        
        // Check for MediaWiki
        if (!isMediaWiki(responseText)) {
            console.log(`   ⚠️ ${wiki.site}: Not MediaWiki`);
            stats.notMediaWiki++;
            
            // Could mark as dead/inactive here
            return;
        }
        
        const is200 = response.status === 200;
        const is404WithNoText = response.status === 404 && 
            responseText.includes("There is currently no text in this page");
        
        if (is200 || is404WithNoText) {
            stats.alive++;
            
            // Extract MW version and update if needed
            const mwVersion = extractMwVersion(responseText);
            if (mwVersion) {
                // Load current entity to check existing version
                const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
                    .then(res => res?.json() || { entities: {} });
                
                if (entities?.[wiki.item]) {
                    const simpleClaims = simplifyClaims(entities[wiki.item].claims);
                    const currentVersion = simpleClaims.P57?.[0];
                    
                    if (currentVersion !== mwVersion) {
                        world.queueWork.claimEnsure(
                            queues.one,
                            { id: wiki.item, property: 'P57', value: mwVersion },
                            { summary: `Update [[Property:P57]] to ${mwVersion} from main page meta` }
                        );
                        console.log(`   ✅ ${wiki.site}: MW ${mwVersion} (was: ${currentVersion || 'unset'})`);
                        stats.mwVersionUpdated++;
                    } else {
                        console.log(`   ✅ ${wiki.site}: MW ${mwVersion}`);
                    }
                }
            } else {
                console.log(`   ✅ ${wiki.site}: alive (no MW version found)`);
            }
            
            // Ensure activity status is active
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P13', value: 'Q54' },
                { summary: `Set [[Property:P13]] to [[Item:Q54]] (active) - responds with MediaWiki` }
            );
        } else {
            console.log(`   ❌ ${wiki.site}: HTTP ${response.status}`);
            stats.dead++;
        }
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
    console.log(`   Total:            ${stats.total}`);
    console.log(`   Alive:            ${stats.alive}`);
    console.log(`   Dead:             ${stats.dead}`);
    console.log(`   Redirected:       ${stats.redirected}`);
    console.log(`   Not MediaWiki:    ${stats.notMediaWiki}`);
    console.log(`   Failed:           ${stats.failed}`);
    console.log(`   MW Version Updated: ${stats.mwVersionUpdated}`);
}

/**
 * Main
 */
async function main() {
    console.log('🏥 Check Alive - Wiki Health Check');
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
    console.log(`   Found ${wikis.length} wikis to check`);
    console.log('');
    
    // Queue all wiki checks
    for (const wiki of wikis) {
        queues.many.add(() => processWiki(wiki), { jobName: `check:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();
