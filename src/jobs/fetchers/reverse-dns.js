/**
 * Reverse DNS Fetcher - Performs reverse DNS lookup for wiki domain
 * 
 * Subscribes to: wiki.discovered
 * Emits: wiki.data.reverse-dns
 */

import dns from 'dns';

/**
 * Perform reverse DNS lookup for a domain
 * @param {string} domain - The domain to lookup
 * @returns {Promise<string[]>}
 */
export async function fetchReverseDNS(domain) {
    return new Promise((resolve) => {
        dns.lookup(domain, (err, address) => {
            if (err) {
                resolve([]);
                return;
            }
            
            dns.reverse(address, (err, hostnames) => {
                if (err) {
                    resolve([]);
                } else {
                    resolve(hostnames || []);
                }
            });
        });
    });
}

/**
 * Register the reverse DNS fetcher with the event bus
 * Note: This is typically called during wiki discovery, not as a separate fetcher
 */
export function register() {
    // Reverse DNS is typically fetched as part of the wiki discovery process
    // This is available as a utility function
}

export default { register, fetchReverseDNS };
