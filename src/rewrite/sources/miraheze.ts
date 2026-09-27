import type { WikiCandidate } from '../model.js';

export interface MirahezeSourceOptions {
    endpoint?: string;
    fetch?: typeof globalThis.fetch;
    concurrency?: number;
}

function getStatusClaim(html: string, responseOk: boolean): string | undefined {
    if (html.includes('<title>Wiki deleted</title>') ||
        html.includes('<h1><b>Wiki deleted</b></h1>')) {
        return 'Q57';
    }
    if (html.includes('This wiki has been automatically closed because there have been') ||
        html.includes('Dormancy Policy">closed</a>')) {
        return 'Q1345';
    }
    return responseOk ? 'Q54' : undefined;
}

export function createMirahezeSource({
    endpoint = 'https://www.irccloud.com/pastebin/raw/cOYehYeA/wr.php',
    fetch: fetchImpl = globalThis.fetch,
    concurrency = 8,
}: MirahezeSourceOptions = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new RangeError('concurrency must be a positive safe integer');
    }

    return {
        async discover(): Promise<WikiCandidate[]> {
            const response = await fetchImpl(endpoint);
            if (!response.ok) throw new Error(`Miraheze wiki list returned HTTP ${response.status}`);
            const list = await response.text();
            const databases = [...list.matchAll(/'([a-z0-9]+)wiki'\s*=>/g)]
                .map(match => match[1]);
            const uniqueDatabases = [...new Set(databases)];
            const candidates = new Array<WikiCandidate>();
            let index = 0;

            const worker = async () => {
                while (index < uniqueDatabases.length) {
                    const database = uniqueDatabases[index++];
                    const domain = `${database}.miraheze.org`;
                    const initialSite = `https://${domain}`;
                    const homeResponse = await fetchImpl(initialSite, { redirect: 'follow' });
                    const finalSite = new URL(homeResponse.url || initialSite).origin;
                    const finalDomain = new URL(finalSite).hostname;

                    const statusUrl = new URL(`/wiki/Main_Page?uselang=en`, initialSite);
                    const statusResponse = await fetchImpl(statusUrl);
                    const status = getStatusClaim(
                        await statusResponse.text(),
                        statusResponse.ok,
                    );
                    const aliases = finalDomain !== domain ? [domain] : undefined;

                    candidates.push({
                        source: 'Miraheze wiki list',
                        site: finalSite,
                        label: finalDomain,
                        ...(aliases && { aliases }),
                        claims: {
                            P1: finalSite,
                            P2: 'Q118',
                            P3: 'Q10',
                            ...(status && { P13: status }),
                        },
                        ...(status && { syncClaims: { P13: status } }),
                    });
                }
            };

            await Promise.all(
                Array.from(
                    { length: Math.min(concurrency, uniqueDatabases.length) },
                    () => worker(),
                ),
            );
            return candidates;
        },
    };
}
