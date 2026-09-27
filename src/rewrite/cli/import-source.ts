import { discoverWikis } from '../discover.js';
import { loadKnownWikis } from '../wikibase-reader.js';
import { createWikibaseWriter } from '../wikibase-writer.js';
import { mediaWikiWikibaseVerifier } from '../verifier.js';
import type { ClaimWriter, WikiCandidate, WikiDiscoverySource, WikiWriter } from '../model.js';

function getOption(args: string[], prefix: string): string | undefined {
    return args.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseLimit(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('--limit must be a positive integer');
    }
    return limit;
}

export async function runImportCli(
    source: WikiDiscoverySource,
    args = process.argv.slice(2),
): Promise<void> {
    const unknownArgs = args.filter(argument =>
        argument !== '--write' && !argument.startsWith('--filter=') && !argument.startsWith('--limit='),
    );
    if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);

    const write = args.includes('--write');
    const filter = getOption(args, '--filter=')?.toLowerCase();
    const limit = parseLimit(getOption(args, '--limit='));
    const instance = process.env.TARGET_WIKIBASE_URL ?? 'http://localhost:8080';
    const localTarget = ['localhost', '127.0.0.1', '::1'].includes(new URL(instance).hostname);

    let writer: WikiWriter;
    let claimWriter: ClaimWriter | undefined;
    if (write) {
        const username = process.env.TARGET_WIKIBASE_USERNAME ?? (localTarget ? 'Admin' : undefined);
        const password = process.env.TARGET_WIKIBASE_PASSWORD ?? (localTarget ? 'wikibase-local-only' : undefined);
        if (!username || !password) {
            throw new Error('Set TARGET_WIKIBASE_USERNAME and TARGET_WIKIBASE_PASSWORD before using --write');
        }
        const wikibaseWriter = createWikibaseWriter({
            instance,
            username,
            password,
            bot: process.env.TARGET_WIKIBASE_BOT === undefined
                ? !localTarget
                : process.env.TARGET_WIKIBASE_BOT === 'true',
        });
        writer = wikibaseWriter;
        claimWriter = wikibaseWriter;
    } else {
        writer = {
            async create(_candidate: WikiCandidate): Promise<string> {
                throw new Error('The writer must not be used during a dry run');
            },
        };
    }

    let candidates = await source.discover();
    const allCandidates = candidates;
    if (filter) candidates = candidates.filter(candidate =>
        candidate.site.toLowerCase().includes(filter),
    );
    if (limit !== undefined) candidates = candidates.slice(0, limit);

    const knownWikis = await loadKnownWikis(instance, {
        sparqlEndpoint: process.env.TARGET_WIKIBASE_SPARQL_ENDPOINT,
    });
    const missingUpdates = limit === undefined
        ? source.syncMissing?.(knownWikis, allCandidates).filter(update =>
            !filter || update.site.toLowerCase().includes(filter),
        ) ?? []
        : [];
    const results = await discoverWikis({
        candidates,
        knownWikis,
        verifier: mediaWikiWikibaseVerifier,
        writer,
        dryRun: !write,
    });

    for (const result of results) {
        const updates = Object.keys(result.candidate.syncClaims ?? {});
        if (write && result.status === 'existing' && result.item && claimWriter) {
            for (const [property, value] of Object.entries(result.candidate.syncClaims ?? {})) {
                await claimWriter.ensureClaim({
                    id: result.item,
                    property,
                    value,
                    policy: 'single',
                    summary: `Sync [[Property:${property}]] from ${result.candidate.source}`,
                });
            }
        }
        const plannedUpdates = !write && result.status === 'existing' && updates.length
            ? ` (would sync ${updates.join(', ')})`
            : '';
        console.log(`${result.status.padEnd(9)} ${result.site}${result.item ? ` → ${result.item}` : ''}${plannedUpdates}`);
    }
    for (const update of missingUpdates) {
        if (write && claimWriter) {
            await claimWriter.ensureClaim({
                id: update.item,
                property: update.property,
                value: update.value,
                policy: update.policy,
                summary: `Sync [[Property:${update.property}]] from ${update.source}`,
            });
        }
        console.log(`${write ? 'updated' : 'would update'} ${update.site} → ${update.item} (${update.property})`);
    }

    const summary = results.reduce<Record<string, number>>((totals, result) => {
        totals[result.status] = (totals[result.status] ?? 0) + 1;
        return totals;
    }, {});
    if (missingUpdates.length) summary.offline = missingUpdates.length;
    console.log(`Processed ${results.length} candidates: ${JSON.stringify(summary)}`);
    if (!write) console.log('Dry run only. Pass --write to create items.');
}
