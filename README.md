# Addbot@wikibase.world

A set of scripts for helping to maintain and sync data on https://wikibase.world

https://wikibase.world/wiki/Special:Contributions/Addbot

## Configuration

This project can be configured using environment variables.

### Wikibase Credentials

These are required for scripts that interact with wikibase.world directly (e.g., `cmd/tidy-url.js`, `cmd/tidy-world.js`).

*   `WORLD_USERNAME`: Your username for wikibase.world.
*   `WORLD_PASSWORD`: Your password for wikibase.world.

### Queue Concurrency

The scripts use queues to manage the rate of operations, especially API calls. The concurrency of these queues can be configured to fine-tune performance and respect API rate limits.

*   `QUEUE_CONCURRENCY_MANY`: Sets concurrency for the 'many' queue.
    *   Default: `4`
    *   Used for tasks that can be highly parallelized.
*   `QUEUE_CONCURRENCY_FOUR`: Sets concurrency for the 'four' queue.
    *   Default: `2`
    *   Used for tasks with moderate parallelization.
*   `QUEUE_CONCURRENCY_ONE`: Sets concurrency for the 'one' queue.
    *   Default: `1`
    *   Used for tasks that must be executed sequentially, such as Wikibase edits, to ensure data integrity and avoid edit conflicts.

If an environment variable for queue concurrency is not set, is not a valid positive integer, or is set to zero or less, the default value will be used. The script will log the concurrency value being used for each queue upon startup (if the `src/general.js` module is loaded).