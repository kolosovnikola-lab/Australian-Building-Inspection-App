# API maintenance commands

## Orphaned finding-media objects

The cleanup command scans only canonical private objects under:

`/objects/finding-media/<inspection>/<finding>/<classification>/<hex-id>`

It excludes every object path or thumbnail path referenced by `finding_media`.
Objects at or after the cutoff are also excluded so uploads still awaiting
completion are not treated as abandoned.

Run a dry scan first:

```sh
pnpm --filter @workspace/api-server run cleanup:orphaned-media -- --before=2026-09-01T00:00:00.000Z
```

The report lists every candidate and does not delete anything. Review that list,
then repeat with `--delete` and the same cutoff:

```sh
pnpm --filter @workspace/api-server run cleanup:orphaned-media -- --before=2026-09-01T00:00:00.000Z --delete
```

Delete mode requires an explicit `--before` timestamp. It locks the
`finding_media` table, rechecks each candidate against current original and
thumbnail references, and reports deleted, newly referenced, and failed paths
separately. Run it only where the API's App Storage environment variables are
available.