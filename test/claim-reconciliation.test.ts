import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    claimValuesEqual,
    numericClaimValue,
    planClaimReconciliation,
    shouldUpdateNumericClaim,
} from '../src/rewrite/claim-reconciliation.js';

describe('claim reconciliation planner', () => {
    it('creates a missing single-value claim and updates a lone different value', () => {
        assert.deepEqual(planClaimReconciliation([], 'new', 'single'), [{ type: 'create' }]);
        assert.deepEqual(
            planClaimReconciliation([{ guid: 'Q1$one', value: 'old' }], 'new', 'single'),
            [{ type: 'update', guid: 'Q1$one' }],
        );
    });

    it('normalizes a single-value property and removes duplicate claims by GUID', () => {
        assert.deepEqual(
            planClaimReconciliation([
                { guid: 'Q1$keep', value: 'wanted' },
                { guid: 'Q1$other', value: 'stale' },
                { guid: 'Q1$duplicate', value: 'wanted' },
            ], 'wanted', 'single'),
            [
                { type: 'remove', guid: 'Q1$other' },
                { type: 'remove', guid: 'Q1$duplicate' },
            ],
        );
    });

    it('adds an included value without deleting other valid values', () => {
        assert.deepEqual(
            planClaimReconciliation([{ guid: 'Q1$old', value: 'other' }], 'new', 'include'),
            [{ type: 'create' }],
        );
        assert.deepEqual(
            planClaimReconciliation([
                { guid: 'Q1$one', value: 'wanted' },
                { guid: 'Q1$two', value: 'wanted' },
                { guid: 'Q1$other', value: 'other' },
            ], 'wanted', 'include'),
            [{ type: 'remove', guid: 'Q1$two' }],
        );
    });

    it('compares Wikibase item, quantity, time, and monolingual text values semantically', () => {
        assert.equal(claimValuesEqual({ id: 'Q10' }, 'Q10'), true);
        assert.equal(
            claimValuesEqual({ amount: '+10', unit: '1', upperBound: '+10' }, { amount: '+10', unit: '1' }),
            true,
        );
        assert.equal(
            claimValuesEqual({ time: '+2024-01-01T00:00:00Z', precision: 11, timezone: 0 }, {
                time: '+2024-01-01T00:00:00Z',
                precision: 11,
            }),
            true,
        );
        assert.equal(
            claimValuesEqual({ text: 'Hello', language: 'en' }, { text: 'Hello', language: 'en' }),
            true,
        );
        assert.equal(
            claimValuesEqual({ amount: '+10', unit: '1' }, { amount: '+10', unit: 'Q1' }),
            false,
        );
    });

    it('applies the legacy logarithmic threshold to numeric changes', () => {
        assert.equal(shouldUpdateNumericClaim(100, 200), false);
        assert.equal(shouldUpdateNumericClaim(100, 1_000), true);
        assert.equal(shouldUpdateNumericClaim(0, 1), true);
        assert.equal(shouldUpdateNumericClaim(0, 0), false);
        assert.equal(numericClaimValue({ amount: '+10', unit: '1' }), 10);
        assert.equal(numericClaimValue('12'), 12);
        assert.equal(numericClaimValue('not a number'), null);
    });
});
