# Addbot@wikibase.world

A set of scripts for helping to maintain and sync data on https://wikibase.world

https://wikibase.world/wiki/Special:Contributions/Addbot

## GitHub Actions

| Workflow | Purpose | Schedule | Trigger |
| --- | --- | --- | --- |
| Rewrite Wiki Import | Discover/import Cloud, Google, Miraheze, or a URL list | None | Manual |
| Rewrite Wiki Sync | Synchronize existing Wikibase World items | None | Manual |
| Test / Lint | Validate the repository | None | Push / pull request |

## Rewrite

The rewrite is being built alongside the legacy scripts. Its first core is in
`src/rewrite/`: source adapters provide `WikiCandidate` records, a shared
pipeline validates and deduplicates them, and a writer applies an explicit
creation plan. The pipeline defaults to dry-run mode. New-item discovery and
existing-item synchronization are added as independently testable steps.

The first replacement paths are wikibase.cloud, Google, Miraheze, and explicit
URL-list discovery.
Cloud creates new items with the source's label, alias, host, site, activity,
main-page, and cloud-ID data; Google creates items with their domain label, site,
and active status; Miraheze maps host, site, and banner-derived status. On
existing items, Cloud synchronizes its cloud ID and marks Cloud sites absent
from a complete, non-empty API result offline; `--limit` disables lifecycle
changes. Miraheze synchronizes the activity status.
`sync:wikis` also scans external links from item/property pages and adds
relationships between known wikis through P55/P56. Host detection now covers
Wikibase Cloud, Professional Wiki, Miraheze/Wikitide, and WMF Labs, including
Cloud endpoint/tool metadata. It also adds missing English descriptions and
removes malformed legacy "Main Page - " aliases. The disabled Wikibase metadata
lookup remains in the existing implementation. The legacy workflow definitions
were removed: Cloud and Google were disabled for inactivity, Tidy World was
manually disabled, and the remaining legacy import workflows were manual-only.
Their scripts remain for parity comparisons. `Rewrite Wiki Sync` and
`Rewrite Wiki Import` are manual-only and default to a 25-item dry-run; they
write only when their `write` input is checked. Import supports Cloud, Google,
Miraheze, and a user-provided URL list. No rewrite workflow is scheduled yet.
Sync can run all updates or one focused action: software/version, wiki metrics,
hosting metadata, wiki-to-wiki links, page metadata cleanup, or activity dates
and status. Select targets by site substring, hostname (including subdomains),
exact Wikibase World item ID, or random sample. The default is a random sample
of 25; dry-run stays enabled unless `write` is checked.

The new importer is dry-run by default and targets the local instance by default:

```sh
npm run import:cloud -- --limit=10
npm run import:cloud -- --filter=example.wikibase.cloud --write
npm run import:google -- --limit=10
npm run import:miraheze -- --limit=10
npm run import:list -- --file=wikis.txt --host=Q8 --limit=10
npm run sync:wikis -- --limit=10
```

`sync:wikis` verifies existing Wikibase items, synchronizes P5 from the first
log event and P73 from the latest change/log with references, P57 and P68–P70
from MediaWiki metadata, and P58 property count, P59–P62 statistics, and P67
max item ID only after a logarithmic change of at least 0.5. Property counts
are capped at 10,000 pages. It adds P13=Q54 only when the activity status is
missing, leaves existing statuses unchanged, detects hosting providers, and
rejects cross-host redirects. It normalizes P1 Main_Page URLs only when the
short URL resolves to the identical page. It also adds P55/P56 relationships for known wikis
linked from item/property pages, adds missing English descriptions, and removes
malformed English aliases. All sync behavior is dry-run by default.

Google discovery requires `SERPAPI_KEY`. For a different target, set
`TARGET_WIKIBASE_URL`; set
`TARGET_WIKIBASE_USERNAME` and `TARGET_WIKIBASE_PASSWORD` before passing
`--write`. Bot edits are enabled by default for non-local targets; set
`TARGET_WIKIBASE_BOT=false` to disable that assertion. Existing-item lookup uses
the target's `/query/sparql` endpoint if available, otherwise it enumerates item
entities through the Action API.

Run the rewrite core tests and type check with `npm test` and `npm run typecheck`.

### Local Wikibase integration tests

Docker Compose starts an isolated Wikibase and MariaDB at
`http://localhost:8081` for integration tests. This uses a separate Compose
project and volumes so it does not reset or overwrite the general local
instance at port 8080. The image is pinned to MediaWiki 1.43.9, matching
Wikibase World; the local database uses MariaDB 10.11 rather than production's
10.5 series. The checked-in admin credentials are for these disposable local
instances only.

```sh
npm run wikibase:test:up
npm run test:integration
npm run wikibase:test:down
```

The integration test is restricted to `localhost`. It seeds the active
Wikibase World P1–P73 property datatypes into the isolated local instance
(using placeholders for deleted property-ID slots), then exercises real-schema
URL, item, string, quantity, and time claims alongside sync plans, references,
and numeric thresholds. Stopping the stack retains its data;
`npm run wikibase:test:reset` deletes only the integration project's database
and configuration volumes.
