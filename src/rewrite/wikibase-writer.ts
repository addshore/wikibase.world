import WBEdit from 'wikibase-edit';
import { getEntityClaims } from './wikibase-reader.js';
import {
    numericClaimValue,
    planClaimReconciliation,
    shouldUpdateNumericClaim,
} from './claim-reconciliation.js';
import type {
    ClaimValue,
    ClaimWriter,
    EntityMetadataWriter,
    WikiCandidate,
    WikiWriter,
} from './model.js';

export interface WikibaseWriterConfig {
    instance: string;
    username: string;
    password: string;
    bot?: boolean;
    fetch?: typeof globalThis.fetch;
}

export type WikibaseWriter = WikiWriter & ClaimWriter & EntityMetadataWriter;

function readClaimValue(claim: {
    mainsnak?: {
        datavalue?: { type?: string; value?: unknown };
    };
}): ClaimValue | null {
    const datavalue = claim.mainsnak?.datavalue;
    const value = datavalue?.value;
    if (
        datavalue?.type === 'wikibase-entityid' &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'id' in value &&
        typeof value.id === 'string'
    ) {
        return value.id;
    }
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        return Object.fromEntries(Object.entries(value));
    }
    return null;
}

export function createWikibaseWriter({
    instance,
    username,
    password,
    bot = false,
    fetch: fetchImpl = globalThis.fetch,
}: WikibaseWriterConfig): WikibaseWriter {
    const edit = WBEdit({
        instance,
        credentials: { username, password },
        maxlag: 30,
        bot,
    });

    return {
        async create(candidate: WikiCandidate): Promise<string> {
            const labels = candidate.label
                ? { en: candidate.label }
                : { en: new URL(candidate.site).hostname };
            const aliases = candidate.aliases?.length
                ? { en: candidate.aliases }
                : undefined;

            const response = await edit.entity.create({
                labels,
                ...(aliases && { aliases }),
                ...(candidate.claims && { claims: candidate.claims }),
            }, {
                summary: `Importing ${candidate.site} from ${candidate.source}`,
            });
            const item = response.entity?.id;
            if (!item) {
                throw new Error(`Wikibase did not return the created entity ID for ${candidate.site}`);
            }
            return item;
        },
        async ensureClaim({
            id,
            property,
            value,
            policy,
            numericThreshold,
            qualifiers,
            references,
            referenceOnly,
            summary,
        }): Promise<void> {
            const claims = await getEntityClaims(instance, id, fetchImpl);
            const propertyClaims = claims[property] ?? [];
            const existing = propertyClaims.map(claim => {
                if (!claim.id) throw new Error(`Wikibase returned a claim without a GUID for ${id}/${property}`);
                return { guid: claim.id, value: readClaimValue(claim) };
            });
            if (referenceOnly) {
                const matchingClaim = propertyClaims.find(claim =>
                    claim.id &&
                    planClaimReconciliation(
                        [{ guid: claim.id, value: readClaimValue(claim) }],
                        value,
                        'include',
                    ).length === 0,
                );
                if (references && matchingClaim?.id && !(matchingClaim.references?.length)) {
                    await edit.reference.set({
                        guid: matchingClaim.id,
                        snaks: references,
                    }, { summary });
                }
                return;
            }
            if (numericThreshold !== undefined && existing.length === 1) {
                const oldNumber = numericClaimValue(existing[0].value);
                const newNumber = numericClaimValue(value);
                if (
                    oldNumber !== null &&
                    newNumber !== null &&
                    !shouldUpdateNumericClaim(oldNumber, newNumber, numericThreshold)
                ) {
                    return;
                }
            }
            const actions = planClaimReconciliation(existing, value, policy);

            for (const action of actions) {
                if (action.type === 'remove') {
                    await edit.claim.remove({ guid: action.guid }, { summary });
                } else if (action.type === 'update') {
                    await edit.claim.update({ guid: action.guid, newValue: value }, { summary });
                } else {
                    await edit.claim.create({
                        id,
                        property,
                        value,
                        ...(qualifiers && { qualifiers }),
                        ...(references && { references }),
                    }, { summary });
                }
            }

            if (references && !actions.some(action => action.type === 'create')) {
                const refreshedClaims = await getEntityClaims(instance, id, fetchImpl);
                const matchingClaim = (refreshedClaims[property] ?? []).find(claim =>
                    claim.id &&
                    planClaimReconciliation(
                        [{ guid: claim.id, value: readClaimValue(claim) }],
                        value,
                        'include',
                    ).length === 0 &&
                    !claim.references?.length,
                );
                if (matchingClaim?.id) {
                    await edit.reference.set({ guid: matchingClaim.id, snaks: references }, { summary });
                }
            }
        },
        async setDescription({ id, language, value, summary }): Promise<void> {
            await edit.description.set({ id, language, value }, { summary });
        },
        async removeAlias({ id, language, value, summary }): Promise<void> {
            await edit.alias.remove({ id, language, value }, { summary });
        },
    };
}
