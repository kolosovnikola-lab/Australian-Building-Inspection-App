# Public source publication

This operator-only command publishes an explicitly reviewed set of text source files to
`kolosovnikola-lab/Australian-Building-Inspection-App`. It never exports a directory, uses a local
Git commit, updates `main`, force-pushes, or includes local history.

## Authorization and repository setup

1. Authenticate the GitHub CLI interactively (`gh auth login`) as the approved operator. Do not put
   a PAT, token, or other credential in source, a manifest, or an environment file.
2. The authorization must permit repository contents, branch creation, and pull requests. If the
   manifest includes `.github/workflows/*`, GitHub also requires workflow administration (`workflow`
   scope for a classic token, or the equivalent fine-grained Workflows permission).
3. Confirm repository ID `1376964625` is public with default branch `main`. The command also
   requires the applicable repository rules for `main` to contain the strict required check
   `Clean API generation` from integration ID `15368`. It uses the repository-rules endpoint, not
   the legacy branch-protection endpoint.

## Manifest and use

Create an untracked manifest (the recommended name pattern is
`public-source-publication.local.json`):

```json
{
  "repository": "kolosovnikola-lab/Australian-Building-Inspection-App",
  "baseBranch": "main",
  "expectedBaseSha": "0123456789abcdef0123456789abcdef01234567",
  "branch": "public-source/release-2025-01",
  "title": "Publish reviewed application source",
  "body": "Reviewed publication set.",
  "commitMessage": "Publish reviewed application source",
  "files": [
    { "path": "artifacts/sitecheck-au/src/App.tsx", "source": "artifacts/sitecheck-au/src/App.tsx" }
  ],
  "delete": ["artifacts/sitecheck-au/src/retired.ts"]
}
```

Use the exact current remote `main` commit SHA, then run:

```sh
pnpm public-source:publish -- --check public-source-publication.local.json
pnpm public-source:publish -- public-source-publication.local.json
```

The first command is local-only: it validates the manifest and reads/scans all files without making
any GitHub request. The second performs publication.

The command reads and scans every listed local file before its first GitHub write. It then verifies
repository identity, visibility, applicable rules, the pinned required check, and the expected SHA;
verifies the SHA once more immediately before writing; creates blobs and a tree based on the remote
tree; creates a single-parent commit whose parent is that remote SHA; creates a new
`public-source/*` branch; and opens a PR to `main`.

Only explicit, regular UTF-8 text source files under approved source roots, reviewed Markdown under
`docs/`, `README.md`, and selected root config files are accepted. Private/reference filenames,
symlinks, binary/runtime output, uploads, screenshots/reference material, agent/Replit metadata,
environment/secret files, likely credentials, hidden history, dependencies, and bulk directory
discovery are rejected.

Credential detection is deliberately conservative but heuristic; it cannot prove source is safe.
An operator must manually review every manifest entry and the resulting PR. In particular, confirm
that no server-side secret is present in plain text, encoded, encrypted, split, generated, or
obfuscated form. Server-side secrets do not belong in the public repository in any form. If `main`
moves, discard the attempt, review the new diff, and create a manifest with the new expected SHA.