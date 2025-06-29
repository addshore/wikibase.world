# Addbot@wikibase.world

A set of scripts for helping to maintain and sync data on https://wikibase.world

https://wikibase.world/wiki/Special:Contributions/Addbot

## Automated Reports and Schedules

This repository uses GitHub Actions to automate the running of various scripts that help maintain and sync data on https://wikibase.world. These scripts are scheduled as follows:

| Workflow           | Script                   | Schedule (UTC)                | Trigger Type         |
|--------------------|--------------------------|-------------------------------|----------------------|
| Import Metadata    | cmd/import-metadata.js   | Daily at 05:00                | Scheduled & Manual   |
| Import Google      | cmd/import-google.js     | Mondays at 04:00              | Scheduled & Manual   |
| Import Cloud       | cmd/import-cloud.js      | Daily at 02:00                | Scheduled & Manual   |
| Import Miraheze    | cmd/import-miraheze.js   | -                             | Manual Only          |
| Tidy World        | cmd/tidy-world.js        | Every other day at 06:00      | Scheduled & Manual   |

- **Scheduled**: Runs automatically at the specified time.
- **Manual**: Can be triggered from the GitHub Actions UI.
