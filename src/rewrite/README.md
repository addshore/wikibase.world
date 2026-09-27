# TypeScript importer rewrite

The rewrite replaces the shared event bus and per-importer edit queues with a
small, explicit pipeline:

1. A source adapter returns `WikiCandidate` records.
2. The verifier confirms each site exposes a Wikibase repository and returns its
   canonical base URL.
3. Existing items are loaded from SPARQL when available, or from the MediaWiki
   Action API otherwise.
4. The pipeline exact-matches normalized host/path keys, deduplicates redirects,
   and produces dry-run results by default.
5. The Wikibase writer creates items or reconciles explicitly selected claims.

Source adapters must not perform Wikibase writes. Put the source-specific fields
for new items in `claims`; use `syncClaims` only for fields that source is
authoritative for on existing items.

## Available import commands

| Command | Source | Current behavior |
| --- | --- | --- |
| `npm run import:cloud` | wikibase.cloud API | Creates new items; updates P54 and marks absent Cloud sites offline from a complete, non-empty response |
| `npm run import:google` | Google via SerpAPI | Creates new items |
| `npm run import:miraheze` | Miraheze database list | Creates new items; updates P13 for existing sites |
| `npm run import:list -- <url...>` | Explicit URL list | Creates new items; supports `--file=path` and `--host=Q…` |
| `npm run sync:wikis` | Existing Wikibase items | Syncs P1/P5/P13/P55–P62/P67–P70/P73, English descriptions, malformed aliases, and host metadata |

All commands accept `--limit=N`, `--filter=text`, and `--write`. Without
`--write`, the pipeline verifies candidates and prints a plan without editing.
Cloud lifecycle updates are skipped when using `--limit` or when the source
returns no candidates.
`sync:wikis` also supports `--action` to run only `software`, `metrics`,
`hosting`, `links`, `cleanup`, or `activity` updates (`all` is the default).
Select existing wikis with `--filter`, `--domain`, `--item`, or `--random`;
`--limit` caps the selected set. Domain matching includes subdomains, and an
item ID must be an exact Q-ID. Activity sync never replaces an existing status.
`Rewrite Wiki Import` runs Cloud, Google, Miraheze, or URL-list discovery;
`Rewrite Wiki Sync` processes existing items. Sync can run all updates or focus
on software/version, metrics, hosting, links, page metadata cleanup, or activity
dates/status. Both workflows are manual-only, limited to 25 items by default,
and dry-run unless `write` is checked. Sync targets can be selected by site
substring, hostname (including subdomains), exact item ID, or random sample;
the default is a random sample. The limit applies after target selection. They
do not replace any scheduled automation. The legacy workflow definitions have
been removed; their scripts remain for parity comparisons.

## Claim reconciliation

Every claim sync declares one of two policies:

- `single`: ensure exactly one claim with the desired value, updating a lone old
  value and removing conflicting/duplicate claims by GUID.
- `include`: ensure the desired value exists, leaving other distinct values
  intact and removing only duplicate copies of the desired value.

These policies are tested independently and against the local Wikibase writer.
Do not use `single` for multi-value properties.

## Development and local integration testing

```sh
npm test
npm run typecheck
npm run wikibase:test:up
npm run test:integration
npm run wikibase:test:down
```

The integration stack is isolated on port 8081 with its own Docker project and
volumes; it does not overwrite the general local instance on port 8080. Its
MediaWiki 1.43.9 image matches wikibase.world. The test seeds the active
Wikibase World P1–P73 property datatypes (placeholders for deleted ID slots),
then verifies real-schema claim edits and API readback. It is restricted to
localhost. `npm run wikibase:test:reset` deletes only the integration stack's
database and configuration volumes.

Set `TARGET_WIKIBASE_URL`, `TARGET_WIKIBASE_USERNAME`, and
`TARGET_WIKIBASE_PASSWORD` to use a non-local instance. Writes still require the
explicit `--write` flag.

## Migration status

The source adapters, generic claim reconciler, and `sync:wikis` cover only part
of the legacy behavior. `sync:wikis` currently handles P1, P5, P13, P55–P62,
P67–P70 and P73, English descriptions, malformed alias cleanup, and host
claim mappings for Cloud, Professional Wiki, Miraheze/Wikitide, and WMF Labs.
The Wikibase metadata lookup remains disabled (upstream issue 148 reports
duplicate records in its metadata API). The old scripts remain available for
parity comparisons until remaining processors are replaced and tested.
