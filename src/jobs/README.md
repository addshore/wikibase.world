# Jobs Architecture

This directory contains the refactored event-driven architecture for processing wikis.

## Overview

The system uses an event-driven pattern where:

1. **Fetchers** retrieve data from wikis and emit data events
2. **Processors** listen to data events and produce edit actions
3. The **Event Bus** coordinates all communication

## Directory Structure

```
src/
├── events/
│   └── bus.js              # Event bus singleton and event constants
├── claims/
│   └── helpers.js          # Reusable claim manipulation utilities
└── jobs/
    ├── fetchers/           # Data fetchers (emit DATA_* events)
    │   ├── index.js
    │   ├── siteinfo.js     # Fetches MediaWiki siteinfo
    │   ├── inception.js    # Fetches wiki inception date
    │   ├── manifest.js     # Fetches Wikibase manifest
    │   ├── entity-counts.js# Fetches property/item counts
    │   ├── external-links.js # Fetches external URLs
    │   └── reverse-dns.js  # Reverse DNS lookup utility
    └── processors/         # Event processors (listen & emit edits)
        ├── index.js
        ├── inception.js    # P5 - Inception date
        ├── siteinfo/       # Processors for siteinfo data
        │   ├── php-version.js   # P68 - PHP version
        │   ├── db-type.js       # P69 - Database type
        │   ├── db-version.js    # P70 - Database version
        │   └── statistics.js    # P59-P62 - Site statistics
        ├── entity-counts/  # Processors for entity count data
        │   ├── property-count.js # P58 - Property count
        │   └── max-item-id.js    # P67 - Max item ID
        ├── hosts/          # Host detection processors
        │   ├── wikibase-cloud.js   # Q8 - wikibase.cloud
        │   ├── professional-wiki.js # Q7 - Professional Wiki
        │   ├── miraheze.js          # Q118 - Miraheze
        │   └── wmf-labs.js          # Q6 - WMF Labs
        └── wiki/           # General wiki processors
            ├── mediawiki-version.js  # P57 - MW version
            ├── activity-status.js    # P13 - Activity status
            ├── labels-descriptions.js # Labels & descriptions
            ├── url-normalizer.js     # P1 - URL normalization
            └── wiki-links.js         # P55/P56 - Wiki links
```

## Event Flow

```
run.tidy-world
    │
    ▼
wiki.discovered ──────┐
    │                 │
    ▼                 │
wiki.alive            │
    │                 │
    ▼                 │
wiki.context-ready ───┼──► Triggers fetchers
    │                 │
    │    ┌────────────┘
    │    │
    ▼    ▼
wiki.data.siteinfo ──────► siteinfo processors
wiki.data.inception ─────► inception processor
wiki.data.manifest ──────► (future processors)
wiki.data.property-count → property count processor
wiki.data.max-item-id ───► max item ID processor
wiki.data.external-links → wiki links processor
```

## Adding a New Processor

1. Create a new file in the appropriate directory
2. Export a `process` function and a `register` function
3. In `register`, call `eventBus.register(Events.DATA_*, 'processor:name', process)`
4. Add the processor to the directory's `index.js`

Example processor:

```javascript
import { eventBus, Events } from '../../events/bus.js';
import { ensureStringClaim } from '../../claims/helpers.js';

export function process({ wiki, siteinfo, queues }) {
    const value = siteinfo?.general?.someField;
    if (!value) return;
    
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: 'P99',
        value,
        summaryAdd: `Add P99 for ${value}`,
        summaryUpdate: `Update P99 from {old} to {new}`
    });
}

export function register() {
    eventBus.register(Events.DATA_SITEINFO, 'processor:my-processor', process);
}
```

## Claim Helpers

The `src/claims/helpers.js` module provides utilities to reduce boilerplate:

- `ensureStringClaim()` - Add/update string claims with standard logging
- `ensureNumericClaim()` - Add/update numeric claims with logarithmic threshold
- `ensureClaimExists()` - Add claim only if missing
- `ensureClaimIncludes()` - Ensure multi-value claim includes a value
- `shouldUpdateNumericClaim()` - Check if numeric change is significant

## Running

```bash
# Run the refactored tidy script
node cmd/tidy-world-v2.js

# Filter to specific wikis
node cmd/tidy-world-v2.js wikibase.cloud
```
