/**
 * Fetch Reverse DNS - Identify hosting providers
 * 
 * This script performs reverse DNS lookups to identify hosting providers
 * and sets the host (P2) claim accordingly.
 * 
 * Usage:
 *   node cmd/tidy/fetch-reverse-dns.js [filter]
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc } from '../../src/fetch.js';
import { world } from '../../src/world.js';
import { queues, HEADERS } from '../../src/general.js';
import dns from 'dns';
import { promisify } from 'util';
import process from 'process';

const reverseLookup = promisify(dns.reverse);
const lookup = promisify(dns.lookup);

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running with filter: ${scriptFilter}`);
}

// Host detection patterns
const HOST_PATTERNS = {
    'wikibase.cloud': 'Q8',
    'professional.wiki': 'Q7',
    'miraheze.org': 'Q118',
    'toolforge.org': 'Q6',
    'wmflabs.org': 'Q6',
    'wikimedia.org': 'Q6',
};

// Statistics
const stats = {
    total: 0,
    identified: 0,
    alreadySet: 0,
    unknown: 0,
    failed: 0,
};

/**
 * Perform reverse DNS lookup
 */
async function fetchReverseDNS(domain) {
    try {
        const { address } = await lookup(domain);
        const hostnames = await reverseLookup(address);
        return hostnames;
    } catch {
        return [];
    }
}

/**
 * Identify host from domain and reverse DNS
 */
function identifyHost(domain, reverseDNS) {
    // Check domain directly
    for (const [pattern, qid] of Object.entries(HOST_PATTERNS)) {
        if (domain.includes(pattern)) {
            return { qid, reason: `domain contains ${pattern}` };
        }
    }
    
    // Check reverse DNS
    for (const hostname of reverseDNS) {
        for (const [pattern, qid] of Object.entries(HOST_PATTERNS)) {
            if (hostname.includes(pattern)) {
                return { qid, reason: `rDNS ${hostname} contains ${pattern}` };
            }
        }
    }
    
    return null;
}

/**
 * Process a single wiki
 */
async function processWiki(wiki) {
    try {
        // Load entity
        const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
            .then(res => res?.json() || { entities: {} });
        
        if (!entities?.[wiki.item]) {
            stats.failed++;
            return;
        }
        
        const simpleClaims = simplifyClaims(entities[wiki.item].claims);
        
        // Check if host already set
        if (simpleClaims.P2?.length > 0) {
            stats.alreadySet++;
            return;
        }
        
        const domain = new URL(wiki.site).hostname;
        const reverseDNS = await fetchReverseDNS(domain);
        
        const host = identifyHost(domain, reverseDNS);
        
        if (host) {
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P2', value: host.qid },
                { summary: `Set [[Property:P2]] to [[Item:${host.qid}]] (${host.reason})` }
            );
            
            console.log(`   ✅ ${wiki.site}: Host ${host.qid} (${host.reason})`);
            stats.identified++;
        } else {
            console.log(`   ❓ ${wiki.site}: Unknown host (rDNS: ${reverseDNS.join(', ') || 'none'})`);
            stats.unknown++;
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
    console.log(`   Total:         ${stats.total}`);
    console.log(`   Identified:    ${stats.identified}`);
    console.log(`   Already set:   ${stats.alreadySet}`);
    console.log(`   Unknown:       ${stats.unknown}`);
    console.log(`   Failed:        ${stats.failed}`);
}

/**
 * Main
 */
async function main() {
    console.log('🔍 Fetch Reverse DNS - Host Identification');
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
    
    // Queue all wiki processing (use four queue for DNS lookups to avoid overwhelming)
    for (const wiki of wikis) {
        queues.four.add(() => processWiki(wiki), { jobName: `rdns:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();
