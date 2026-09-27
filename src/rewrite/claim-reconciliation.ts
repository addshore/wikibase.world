import { isDeepStrictEqual } from 'node:util';
import type { ClaimValue } from './model.js';

export interface ExistingClaim {
    guid: string;
    value: ClaimValue | null;
}

export type ClaimPolicy = 'single' | 'include';

export type ClaimAction =
    | { type: 'create' }
    | { type: 'update'; guid: string }
    | { type: 'remove'; guid: string };

function normalizeValue(value: ClaimValue | null): unknown {
    if (value === null || typeof value !== 'object') return value;
    if ('id' in value && typeof value.id === 'string') return value.id;
    if ('amount' in value) {
        return {
            amount: value.amount,
            unit: 'unit' in value ? value.unit : undefined,
        };
    }
    if ('time' in value) {
        return {
            time: value.time,
            precision: 'precision' in value ? value.precision : undefined,
            calendarModel: 'calendarmodel' in value ? value.calendarmodel : undefined,
        };
    }
    if ('text' in value && 'language' in value) {
        return { text: value.text, language: value.language };
    }
    return value;
}

export function claimValuesEqual(left: ClaimValue | null, right: ClaimValue): boolean {
    return isDeepStrictEqual(normalizeValue(left), normalizeValue(right));
}

export function shouldUpdateNumericClaim(
    oldValue: number,
    newValue: number,
    threshold = 0.5,
): boolean {
    if (oldValue === 0 || newValue === 0) return oldValue !== newValue;
    const logDifference = Math.abs(Math.log10(newValue) - Math.log10(oldValue));
    return logDifference >= threshold;
}

export function numericClaimValue(value: ClaimValue | null): number | null {
    const raw = value !== null && typeof value === 'object' && 'amount' in value
        ? value.amount
        : value;
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'string' && raw.trim() === '') return null;
    const number = Number(typeof raw === 'string' ? raw.replace(/^\+/, '') : raw);
    return Number.isFinite(number) ? number : null;
}

export function planClaimReconciliation(
    existing: ExistingClaim[],
    desired: ClaimValue,
    policy: ClaimPolicy,
): ClaimAction[] {
    const matching = existing.filter(claim => claimValuesEqual(claim.value, desired));

    if (matching.length > 0) {
        const keep = matching[0];
        const remove = policy === 'single'
            ? existing.filter(claim => claim !== keep)
            : matching.slice(1);
        return remove.map(claim => ({ type: 'remove', guid: claim.guid }));
    }

    if (policy === 'include' || existing.length === 0) return [{ type: 'create' }];
    if (existing.length === 1) return [{ type: 'update', guid: existing[0].guid }];

    return [
        ...existing.map(claim => ({ type: 'remove' as const, guid: claim.guid })),
        { type: 'create' },
    ];
}
