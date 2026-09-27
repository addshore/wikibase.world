import { randomInt } from 'node:crypto';
import type { ClaimValue, KnownWiki } from './model.js';
import type { RawClaim } from './wikibase-reader.js';

export interface WikiClaimSync {
    property: string;
    value: ClaimValue;
    policy: 'single' | 'include';
    numericThreshold?: number;
    qualifiers?: Record<string, ClaimValue>;
    references?: Record<string, ClaimValue>;
    referenceOnly?: boolean;
}

export interface WikiSyncSelection {
    filter?: string;
    domain?: string;
    item?: string;
    random?: boolean;
    limit?: number;
}

function normalizeDomain(domain: string): string {
    const value = domain.trim().toLowerCase().replace(/\.$/, '');
    if (!value || /[/:?#@]/.test(value)) {
        throw new TypeError('--domain must be a hostname without a scheme, port, or path');
    }
    return new URL(`http://${value}`).hostname;
}

export function selectWikisForSync(
    wikis: KnownWiki[],
    selection: WikiSyncSelection = {},
): KnownWiki[] {
    const { filter, domain, item, random = false, limit } = selection;
    if (item && !/^Q\d+$/.test(item)) {
        throw new TypeError('--item must be an item ID such as Q123');
    }
    const normalizedFilter = filter?.toLowerCase();
    const normalizedDomain = domain === undefined ? undefined : normalizeDomain(domain);
    let selected = wikis.filter(wiki => {
        if (normalizedFilter && !wiki.site.toLowerCase().includes(normalizedFilter)) return false;
        if (item && wiki.item !== item) return false;
        if (normalizedDomain) {
            const hostname = new URL(wiki.site).hostname.toLowerCase();
            if (hostname !== normalizedDomain && !hostname.endsWith(`.${normalizedDomain}`)) {
                return false;
            }
        }
        return true;
    });
    if (random) {
        selected = [...selected];
        for (let index = selected.length - 1; index > 0; index--) {
            const otherIndex = randomInt(index + 1);
            [selected[index], selected[otherIndex]] = [selected[otherIndex], selected[index]];
        }
    }
    return limit === undefined ? selected : selected.slice(0, limit);
}

export function extractMediaWikiVersion(html: string): string | undefined {
    return html.match(/<meta name="generator" content="MediaWiki (.+?)"/)?.[1];
}

export function planWikiClaimSyncs(
    wiki: KnownWiki,
    mediaWikiVersion: string | undefined,
): WikiClaimSync[] {
    const syncs: WikiClaimSync[] = [];
    if (mediaWikiVersion) {
        syncs.push({ property: 'P57', value: mediaWikiVersion, policy: 'single' });
    }
    if (!wiki.statusItem) {
        syncs.push({ property: 'P13', value: 'Q54', policy: 'include' });
    }
    return syncs;
}

export interface SiteInfoQuery {
    general?: unknown;
    statistics?: unknown;
    namespaces?: unknown;
}

export interface EntityMetrics {
    propertyCount?: number;
    maxItemId?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export function planSiteInfoClaimSyncs(query: SiteInfoQuery): WikiClaimSync[] {
    const syncs: WikiClaimSync[] = [];
    const general = asRecord(query.general);
    const statistics = asRecord(query.statistics);

    for (const [property, key] of [
        ['P68', 'phpversion'],
        ['P69', 'dbtype'],
        ['P70', 'dbversion'],
    ] as const) {
        const value = general[key];
        if (typeof value === 'string' && value.length > 0) {
            syncs.push({ property, value, policy: 'single' });
        }
    }

    for (const [property, key] of [
        ['P62', 'pages'],
        ['P59', 'edits'],
        ['P60', 'users'],
        ['P61', 'activeusers'],
    ] as const) {
        const rawValue = statistics[key];
        const value = typeof rawValue === 'number'
            ? rawValue
            : typeof rawValue === 'string' && rawValue.trim() !== ''
                ? Number(rawValue)
                : Number.NaN;
        if (Number.isFinite(value) && value >= 0) {
            syncs.push({
                property,
                value,
                policy: 'single',
                numericThreshold: 0.5,
            });
        }
    }

    return syncs;
}

export function planEntityMetricClaimSyncs(metrics: EntityMetrics): WikiClaimSync[] {
    const syncs: WikiClaimSync[] = [];
    if (metrics.propertyCount !== undefined) {
        syncs.push({
            property: 'P58',
            value: metrics.propertyCount,
            policy: 'single',
            numericThreshold: 0.5,
        });
    }
    if (metrics.maxItemId !== undefined) {
        syncs.push({
            property: 'P67',
            value: metrics.maxItemId,
            policy: 'single',
            numericThreshold: 0.5,
        });
    }
    return syncs;
}

export function findEntityNamespaces(namespaces: unknown): { item?: number; property?: number } {
    const namespaceEntries = asRecord(namespaces);
    const found: { item?: number; property?: number } = {};
    for (const namespace of Object.values(namespaceEntries)) {
        const details = asRecord(namespace);
        if (typeof details.id !== 'number' || !Number.isSafeInteger(details.id)) continue;
        if (details.defaultcontentmodel === 'wikibase-item') found.item = details.id;
        if (details.defaultcontentmodel === 'wikibase-property') found.property = details.id;
    }
    return found;
}

export function planInceptionClaimSync(
    date: string,
    apiUrl: string,
    today: string,
    existingClaims: RawClaim[] = [],
): WikiClaimSync[] {
    const references = { P21: apiUrl, P22: today };
    if (existingClaims.length === 0) {
        return [{
            property: 'P5',
            value: date,
            policy: 'single',
            references,
        }];
    }

    if (existingClaims.length !== 1) return [];

    const claim = existingClaims[0];
    const rawValue = claim.mainsnak?.datavalue?.value;
    const existingDate = typeof rawValue === 'string'
        ? rawValue.replace(/^\+/, '').split('T')[0]
        : rawValue !== null && typeof rawValue === 'object' && 'time' in rawValue &&
            typeof rawValue.time === 'string'
            ? rawValue.time.replace(/^\+/, '').split('T')[0]
            : undefined;
    if (existingDate !== date || claim.references?.length) return [];

    return [{
        property: 'P5',
        value: date,
        policy: 'single',
        references,
        referenceOnly: true,
    }];
}

export function planLastEditClaimSync(
    timestamp: string,
    apiUrl: string,
    today: string,
): WikiClaimSync[] {
    const date = timestamp.match(/^(\d{4})-(\d{2})-\d{2}T/);
    if (!date) return [];
    const yearMonth = `${date[1]}-${date[2]}`;
    return [{
        property: 'P73',
        value: {
            time: `+${yearMonth}-01T00:00:00Z`,
            timezone: 0,
            before: 0,
            after: 0,
            precision: 10,
            calendarmodel: 'http://www.wikidata.org/entity/Q1985727',
        },
        policy: 'single',
        references: { P21: apiUrl, P22: today },
    }];
}

export function planMainPageUrlNormalization(
    site: string,
    originalFinalUrl: string,
    shortenedFinalUrl: string,
    existingP1: RawClaim[],
): WikiClaimSync[] {
    const shortenedSite = site.replace(/\/wiki\/Main_Page$/, '');
    if (
        shortenedSite === site ||
        existingP1.length !== 1 ||
        originalFinalUrl !== shortenedFinalUrl ||
        existingP1[0].mainsnak?.datavalue?.value !== site
    ) {
        return [];
    }
    return [{ property: 'P1', value: shortenedSite, policy: 'single' }];
}
