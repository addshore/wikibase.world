import fetch from 'node-fetch';
import fs from 'fs';
import { world } from './../src/world.js';
import { queues, HEADERS } from './../src/general.js';

// Usage:
//   node cmd/import-list.js urls.txt
//   node cmd/import-list.js https://example.org https://other.example
// Optional: pass a host QID as second argument to set P2 for all imports

// Support a --dry-run flag and optional --concurrency=N. Remove them from args for normal processing.
const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
let concurrency = 4;
const concArg = rawArgs.find(a => a.startsWith('--concurrency='));
if (concArg) {
    const parts = concArg.split('=');
    const v = parseInt(parts[1], 10);
    if (!Number.isNaN(v) && v > 0) concurrency = v;
}
const args = rawArgs.filter(a => a !== '--dry-run' && !a.startsWith('--concurrency='));
if (args.length === 0) {
    console.log('Usage: node cmd/import-list.js <file-or-urls...> [hostQid] [--dry-run] [--concurrency=N]');
    process.exit(1);
}

let hostQid = args[args.length - 1];
let maybeFile = args[0];
let inputURLs = [];

// Simple fetch with timeout using AbortController
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

// If the first arg is an HTTP(S) URL, try to fetch it and parse lines as input URLs.
// If the fetched payload contains multiple non-empty lines, treat it as a list.
async function tryFetchListFromUrl(url) {
    try {
        const res = await fetchWithTimeout(url, { headers: HEADERS, redirect: 'follow' }, 15000);
        if (!res) return null;
        const text = await res.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 1) return lines;
        return null;
    } catch (e) {
        return null;
    }
}

// If first arg is an existing file, read it (one URL/domain per line)
if (maybeFile && maybeFile.startsWith('http')) {
    // Always attempt to fetch the remote URL. If it contains multiple lines,
    // treat it as a list of sites. Otherwise fall back to treating the arg
    // as a single site URL.
    const remoteLines = await tryFetchListFromUrl(maybeFile);
    if (remoteLines && remoteLines.length > 0) {
        inputURLs = remoteLines;
        if (args.length > 1) hostQid = args[1]; else hostQid = undefined;
    } else if (fs.existsSync(maybeFile)) {
        const txt = fs.readFileSync(maybeFile, 'utf8');
        inputURLs = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (args.length > 1) {
            hostQid = args[1];
        } else {
            hostQid = undefined;
        }
    } else {
        // Not a remote list and not a local file: treat the HTTP arg as a single URL to import
        inputURLs = [maybeFile];
        hostQid = undefined;
    }
} else {
    // treat all args except maybe last as urls
    if (args.length === 1) {
        inputURLs = [args[0]];
        hostQid = undefined;
    } else {
        // if last looks like Q\d+ then treat as hostQid
        const last = args[args.length - 1];
        if (/^Q\d+$/.test(last)) {
            hostQid = last;
            inputURLs = args.slice(0, -1);
        } else {
            inputURLs = args;
            hostQid = undefined;
        }
    }
}

// Normalize lines: if a line is a bare domain, ensure it has scheme
function normalizeToUrl(s) {
    if (!s) return null;
    s = s.trim();
    if (!s) return null;
    if (!s.startsWith('http://') && !s.startsWith('https://')) {
        s = 'https://' + s;
    }
    try {
        const u = new URL(s);
        return u.href.replace(/\/$/, '');
    } catch (e) {
        return null;
    }
}

// Simple status detection (copied from import-miraheze heuristics)
async function getWikiStatusByUrl(url) {
    try {
        const response = await fetchWithTimeout(url, { headers: HEADERS }, 10000);
        const text = await response.text();
        if (text.includes('<title>Wiki deleted</title>') || text.includes('<h1><b>Wiki deleted</b></h1>')) {
            return 'Q57';
        }
        // Treat an explicit "Wiki deleted" marker as permanently offline.
        // Otherwise, use HTTP success (200) or 404-with-no-text as active; default to active.
        return 'Q54';
    } catch (e) {
        return 'Q54';
    }
}

async function resolveFinal(url) {
    try {
        const res = await fetchWithTimeout(url, { headers: HEADERS, redirect: 'follow' }, 15000);
        const html = await res.text();
        return { url: res.url, html };
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('📥 Import list — queuing sites for import');
    const worldWikis = await world.sparql.wikisAll();
    const worldWikiURLs = worldWikis.map(w => w.site.toLowerCase());
    // Build a map of existing host -> item for fast exact hostname lookup
    const existingHostToItem = new Map();
    for (const w of worldWikis) {
        try {
            const host = new URL(w.site).hostname.toLowerCase();
            if (!existingHostToItem.has(host)) existingHostToItem.set(host, w.item);
        } catch (e) {
            // ignore malformed site
        }
    }

    // Deduplicate inputURLs by normalized hostname to avoid duplicate work
    const normalizedInputs = inputURLs.map(normalizeToUrl).filter(Boolean);
    const hostSeen = new Map();
    for (const u of normalizedInputs) {
        try {
            const host = new URL(u).hostname.toLowerCase();
            if (!hostSeen.has(host)) hostSeen.set(host, u);
        } catch (e) {
            // ignore
        }
    }
    inputURLs = Array.from(hostSeen.values());

    // Track domains currently being processed to prevent duplicate creations across workers
    const inProgressDomains = new Set();

    // Process inputURLs with limited concurrency
    let idx = 0;
    const processLine = async (line) => {
        const normalized = normalizeToUrl(line);
        if (!normalized) {
            console.log(`Skipping invalid line: ${line}`);
            return;
        }

        console.log(`Fetching ${normalized}`);
        const r = await resolveFinal(normalized);
        if (!r) {
            console.log(`Failed to fetch ${normalized}`);
            return;
        }

        // Only proceed if page mentions "Wikibase" somewhere (simple heuristic)
        if (!r.html.includes('wikibase') && !r.html.includes('Wikibase')) {
            console.log(`Skipping ${r.url} — does not appear to be a Wikibase site`);
            return;
        }

        const domain = new URL(r.url).hostname.toLowerCase();

        // If already in world, skip — use exact hostname lookup
        if (existingHostToItem.has(domain)) {
            const existingItem = existingHostToItem.get(domain);
            console.log(`Skipping existing item ${existingItem} (${domain}) — already in wikibase.world`);
            return;
        }

        // If another worker is already processing this domain, skip to avoid duplicates
        if (inProgressDomains.has(domain)) {
            console.log(`Skipping ${domain} — already being processed by another worker`);
            return;
        }
        inProgressDomains.add(domain);

        // Prepare labels/aliases and claims
        const labels = { en: domain };
        const aliases = {};
        try {
            const inputDomain = new URL(normalized).hostname;
            if (inputDomain !== domain) aliases.en = [inputDomain];
        } catch {}

        const claims = {
            P1: r.url,
            P3: 'Q10'
        };
        if (hostQid) claims.P2 = hostQid;

        // Do not set activity (P13) here — keep imports minimal
        if (dryRun) {
            console.log(`DRY-RUN: would create item for ${domain} with claims: ${JSON.stringify(claims)}`);
        } else {
            world.queueWork.itemCreate(queues.one, { labels, ...(Object.keys(aliases).length > 0 && { aliases }), claims }, { summary: `Importing site ${domain} from list` });
            console.log(`Queued import: ${domain} (${r.url})`);
        }

        // Done processing domain — release lock
        inProgressDomains.delete(domain);
    }

    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const i = idx++;
            if (i >= inputURLs.length) break;
            try {
                await processLine(inputURLs[i]);
            } catch (e) {
                console.log(`Error processing ${inputURLs[i]}: ${e.message}`);
            }
        }
    });

    await Promise.all(workers);

    // Wait for queues to settle (simple loop)
    let lastSize = -1;
    let stable = 0;
    while (stable < 3) {
        const currentSize = queues.many.size + queues.many.pending + queues.four.size + queues.four.pending + queues.one.size + queues.one.pending;
        if (currentSize === 0 && lastSize === 0) stable++; else stable = 0;
        lastSize = currentSize;
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('✅ All queued work submitted');
    process.exit(0);
}

main();
