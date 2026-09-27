export interface PageMetadata {
    language: string;
    description?: string;
}

export type EntityMetadataSync =
    | { type: 'description'; language: 'en'; value: string }
    | { type: 'alias-remove'; language: 'en'; value: string };

export interface ExistingLanguageData {
    description?: string;
    aliases?: string[];
}

export function extractPageMetadata(html: string): PageMetadata {
    const rawDescription = html.match(/<meta name="description" content="(.+?)"/)?.[1];
    const language = html.match(/"wgPageContentLanguage":"(.+?)"/)?.[1] ?? 'en';
    const description = rawDescription && rawDescription.length >= 4
        ? rawDescription
            .replace(/&#(\d+);/g, (_match, code: string) => {
                const point = Number(code);
                return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff
                    ? String.fromCodePoint(point)
                    : _match;
            })
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
        : undefined;
    return { language, ...(description && { description }) };
}

export function planEntityMetadataSyncs(
    metadata: PageMetadata,
    existing: ExistingLanguageData,
): EntityMetadataSync[] {
    if (metadata.language !== 'en') return [];
    const syncs: EntityMetadataSync[] = [];
    if (metadata.description && !existing.description) {
        syncs.push({ type: 'description', language: 'en', value: metadata.description });
    }
    for (const alias of existing.aliases ?? []) {
        if (alias.startsWith('Main Page - ')) {
            syncs.push({ type: 'alias-remove', language: 'en', value: alias });
        }
    }
    return syncs;
}
