# Tidy Scripts

Focused single-purpose scripts for maintaining wikibase.world data.

Each script is designed to run independently and fast, focusing on one specific task.

## Scripts

### `check-alive.js`
Verify wikis are online and responding.
- Fetches main page, follows redirects
- Verifies it's still MediaWiki
- Extracts MW version from meta generator (P57)
- Sets activity status (P13)

```bash
node cmd/tidy/check-alive.js [filter]
```

### `fetch-siteinfo.js`
Load MediaWiki siteinfo from API.
- PHP version (P68)
- Database type (P69)
- Database version (P70)
- Site statistics (P59-P62)

```bash
node cmd/tidy/fetch-siteinfo.js [filter]
```

### `fetch-inception.js`
Find wiki creation dates.
- Only processes wikis without P5 set
- Queries first log entry
- Sets inception date (P5)

```bash
node cmd/tidy/fetch-inception.js [filter]
```

### `fetch-reverse-dns.js`
Identify hosting providers via reverse DNS.
- Performs rDNS lookup
- Matches known host patterns
- Sets host (P2) if not already set

```bash
node cmd/tidy/fetch-reverse-dns.js [filter]
```

### `fetch-manifest.js`
Load Wikibase manifest data from REST API.
- Property count (P58)
- Max item ID (P67)

```bash
node cmd/tidy/fetch-manifest.js [filter]
```

### `fetch-external-links.js`
Find wiki-to-wiki links.
- Fetches external links from each wiki
- Creates links (P55/P56) between wikis

```bash
node cmd/tidy/fetch-external-links.js [filter]
```

## Running All Scripts

You can run all scripts in sequence:

```bash
# Quick health check
node cmd/tidy/check-alive.js

# Detailed data collection
node cmd/tidy/fetch-siteinfo.js
node cmd/tidy/fetch-inception.js
node cmd/tidy/fetch-manifest.js

# Host identification (slower due to DNS)
node cmd/tidy/fetch-reverse-dns.js

# Link discovery (can be slow)
node cmd/tidy/fetch-external-links.js
```

Or run them in parallel for maximum speed:

```bash
# Run multiple scripts in parallel (in separate terminals)
node cmd/tidy/check-alive.js &
node cmd/tidy/fetch-siteinfo.js &
node cmd/tidy/fetch-inception.js &
wait
```

## Filtering

All scripts support an optional filter argument to process only matching wikis:

```bash
# Only process wikibase.cloud wikis
node cmd/tidy/check-alive.js wikibase.cloud

# Only process a specific wiki
node cmd/tidy/fetch-siteinfo.js example.org
```

## Queue Configuration

All scripts use the shared queue configuration from `src/general.js`:
- `queues.many` (32 concurrent) - Network fetches
- `queues.four` (8 concurrent) - Processing with some API calls
- `queues.one` (1 concurrent) - Wikibase edits (serialized due to API maxlag)
