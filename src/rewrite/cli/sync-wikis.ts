import { selectWikisForSync } from '../wiki-sync.js';
import { loadKnownWikis } from '../wikibase-reader.js';
import {
    planWikiSync,
    WIKI_SYNC_ACTIONS,
    type WikiSyncAction,
} from '../wiki-sync-runner.js';
import { createWikibaseWriter, type WikibaseWriter } from '../wikibase-writer.js';
import type { ClaimWriter, KnownWiki } from '../model.js';

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

function isLocalTarget(instance: string): boolean {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(instance).hostname);
}

export async function runWikiSyncCli(args = process.argv.slice(2)): Promise<void> {
    const unknownArgs = args.filter(argument =>
        argument !== '--write' &&
        argument !== '--random' &&
        !argument.startsWith('--filter=') &&
        !argument.startsWith('--limit=') &&
        !argument.startsWith('--domain=') &&
        !argument.startsWith('--item=') &&
        !argument.startsWith('--action='),
    );
    if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);

    const write = args.includes('--write');
    const filter = getOption(args, '--filter=')?.toLowerCase();
    const domain = getOption(args, '--domain=');
    const item = getOption(args, '--item=');
    const random = args.includes('--random');
    const limit = parseLimit(getOption(args, '--limit='));
    const actionOption = getOption(args, '--action=') ?? 'all';
    const action = WIKI_SYNC_ACTIONS.find(candidate => candidate === actionOption);
    if (!action) {
        throw new Error(`--action must be one of: ${WIKI_SYNC_ACTIONS.join(', ')}`);
    }
    const instance = process.env.TARGET_WIKIBASE_URL ?? 'http://localhost:8080';
    const localTarget = isLocalTarget(instance);

    let claimWriter: ClaimWriter | undefined;
    let wikibaseWriter: WikibaseWriter | undefined;
    if (write) {
        const username = process.env.TARGET_WIKIBASE_USERNAME ?? (localTarget ? 'Admin' : undefined);
        const password = process.env.TARGET_WIKIBASE_PASSWORD ?? (localTarget ? 'wikibase-local-only' : undefined);
        if (!username || !password) {
            throw new Error('Set TARGET_WIKIBASE_USERNAME and TARGET_WIKIBASE_PASSWORD before using --write');
        }
        wikibaseWriter = createWikibaseWriter({
            instance,
            username,
            password,
            bot: process.env.TARGET_WIKIBASE_BOT === undefined
                ? !localTarget
                : process.env.TARGET_WIKIBASE_BOT === 'true',
        });
        claimWriter = wikibaseWriter;
    }

    const knownWikis = await loadKnownWikis(instance, {
        sparqlEndpoint: process.env.TARGET_WIKIBASE_SPARQL_ENDPOINT,
    });
    const wikis = selectWikisForSync(knownWikis, {
        filter,
        domain,
        item,
        random,
        limit,
    });
    const totals = { planned: 0, synced: 0, current: 0, skipped: 0, failed: 0 };
    let nextWiki = 0;

    const worker = async () => {
        while (nextWiki < wikis.length) {
            const wiki = wikis[nextWiki++];
            await syncWiki(wiki, instance, knownWikis, claimWriter, wikibaseWriter, action, totals);
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(4, wikis.length) },
        () => worker(),
    ));
    console.log(`Selected ${wikis.length} wikis for action ${action}.`);
    console.log(`Processed ${wikis.length} wikis: ${JSON.stringify(totals)}`);
    console.log(`Action: ${action}`);
    if (!write) console.log('Dry run only. Pass --write to synchronize claims.');
    if (totals.failed) process.exitCode = 1;
}

async function syncWiki(
    wiki: KnownWiki,
    targetInstance: string,
    knownWikis: KnownWiki[],
    claimWriter: ClaimWriter | undefined,
    wikibaseWriter: WikibaseWriter | undefined,
    action: WikiSyncAction,
    totals: { planned: number; synced: number; current: number; skipped: number; failed: number },
): Promise<void> {
    try {
        const plan = await planWikiSync(wiki, { targetInstance, knownWikis, action });
        if (plan.status === 'skipped') {
            totals.skipped++;
            console.log(`skipped   ${wiki.site} (${plan.reason})`);
            return;
        }
        for (const warning of plan.warnings) console.warn(`warning   ${warning}`);
        if (
            plan.syncs.length === 0 &&
            plan.entitySyncs.length === 0 &&
            plan.relatedSyncs.length === 0
        ) {
            totals.current++;
            console.log(`current   ${wiki.site}`);
            return;
        }

        for (const sync of plan.syncs) {
            const value = typeof sync.value === 'string' ? sync.value : JSON.stringify(sync.value);
            if (claimWriter) {
                await claimWriter.ensureClaim({
                    id: wiki.item,
                    property: sync.property,
                    value: sync.value,
                    policy: sync.policy,
                    numericThreshold: sync.numericThreshold,
                    qualifiers: sync.qualifiers,
                    references: sync.references,
                    referenceOnly: sync.referenceOnly,
                    summary: `Sync [[Property:${sync.property}]] from a verified wiki`,
                });
            }
            console.log(`${claimWriter ? 'synced' : 'planned'}   ${wiki.site} → ${wiki.item} (${sync.property}=${value})`);
        }
        for (const sync of plan.relatedSyncs) {
            if (claimWriter) {
                await claimWriter.ensureClaim({
                    id: sync.item,
                    property: sync.property,
                    value: sync.value,
                    policy: 'include',
                    summary: `Add [[Property:${sync.property}]] relationship discovered from ${wiki.site}`,
                });
            }
            console.log(`${claimWriter ? 'synced' : 'planned'}   ${wiki.site} → ${sync.item} (${sync.property}=${sync.value})`);
        }
        for (const sync of plan.entitySyncs) {
            if (wikibaseWriter) {
                if (sync.type === 'description') {
                    await wikibaseWriter.setDescription({
                        id: wiki.item,
                        language: sync.language,
                        value: sync.value,
                        summary: 'Add English description from the wiki main page',
                    });
                } else {
                    await wikibaseWriter.removeAlias({
                        id: wiki.item,
                        language: sync.language,
                        value: sync.value,
                        summary: 'Remove malformed Main Page alias',
                    });
                }
            }
            console.log(`${wikibaseWriter ? 'synced' : 'planned'}   ${wiki.site} → ${wiki.item} (${sync.type}=${sync.value})`);
        }
        if (claimWriter) totals.synced++;
        else totals.planned++;
    } catch (error) {
        totals.failed++;
        console.error(`failed    ${wiki.site}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

runWikiSyncCli().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
