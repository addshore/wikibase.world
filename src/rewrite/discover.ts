import type {
    DiscoveryResult,
    KnownWiki,
    WikiCandidate,
    WikiVerifier,
    WikiWriter,
} from './model.js';
import { canonicalSiteKey } from './site-key.js';

export interface DiscoverOptions {
    candidates: WikiCandidate[];
    knownWikis: KnownWiki[];
    verifier: WikiVerifier;
    writer: WikiWriter;
    dryRun?: boolean;
}

export async function discoverWikis({
    candidates,
    knownWikis,
    verifier,
    writer,
    dryRun = true,
}: DiscoverOptions): Promise<DiscoveryResult[]> {
    const knownSites = new Map(knownWikis.map(wiki => [canonicalSiteKey(wiki.site), wiki]));
    const seenSites = new Set<string>();
    const results: DiscoveryResult[] = [];

    for (const candidate of candidates) {
        let inputKey: string;
        try {
            inputKey = canonicalSiteKey(candidate.site);
        } catch {
            results.push({ candidate, site: candidate.site, status: 'invalid' });
            continue;
        }
        const existingInput = knownSites.get(inputKey);
        if (existingInput) {
            results.push({ candidate, site: existingInput.site, status: 'existing', item: existingInput.item });
            continue;
        }
        if (seenSites.has(inputKey)) {
            results.push({ candidate, site: candidate.site, status: 'duplicate' });
            continue;
        }

        const verified = await verifier.verify(candidate.site);
        if (!verified) {
            seenSites.add(inputKey);
            results.push({ candidate, site: candidate.site, status: 'invalid' });
            continue;
        }

        const verifiedKey = canonicalSiteKey(verified.site);
        const existingVerified = knownSites.get(verifiedKey);
        if (existingVerified) {
            results.push({ candidate, site: existingVerified.site, status: 'existing', item: existingVerified.item });
            continue;
        }
        if (seenSites.has(verifiedKey)) {
            results.push({ candidate, site: verified.site, status: 'duplicate' });
            continue;
        }
        seenSites.add(verifiedKey);

        const claims = candidate.claims
            ? Object.fromEntries(Object.entries(candidate.claims).map(([property, value]) => {
                if (typeof value === 'string' && value.startsWith(candidate.site)) {
                    return [property, `${verified.site}${value.slice(candidate.site.length)}`];
                }
                return [property, value];
            }))
            : undefined;
        const verifiedCandidate = {
            ...candidate,
            site: verified.site,
            ...(claims && { claims }),
        };
        if (dryRun) {
            results.push({ candidate: verifiedCandidate, site: verified.site, status: 'planned' });
            continue;
        }
        const item = await writer.create(verifiedCandidate);
        results.push({ candidate: verifiedCandidate, site: verified.site, status: 'created', item });
    }

    return results;
}
