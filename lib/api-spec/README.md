# Automatic clean-checkout validation

The GitHub Actions workflow `.github/workflows/api-generated.yml` runs
`pnpm run validate:api-generated:clean` on every pull request, merge queue
entry, and push to `main` or `master`; it also supports manual runs. Running
on all pull requests covers specification, generator, lockfile, workspace
configuration and generated-client changes without leaving a required check
pending on path-filtered changes.

It uses Node.js 24.13.0, reads the exact pnpm version from the root
`packageManager` field, and installs dependencies using `--frozen-lockfile`.
The command retains separate `[api-generated] setup`, `generation`, and
`drift` failure diagnostics in the job log. Toolchain setup has its own steps;
dependency or generator setup failures stop before generation, and generation
failures stop before the drift comparison. Full Git history is fetched, with
the pull request or merge queue base selected explicitly for compatibility.

To enforce this as a merge gate, repository administrators should require the
**Clean API generation** status check in their branch protection/ruleset.
The workflow runs automatically, but does not itself change repository rules.

# API contract changes

`openapi.yaml` is the source of truth for the API contract. The generated
React Query client and Zod schemas must be regenerated from that file; do not
edit files under `lib/api-client-react/src/generated` or
`lib/api-zod/src/generated` by hand.

## Normal change workflow

Run the full generated-client validation before opening a change:

```sh
pnpm run validate:api-generated
```

This command:

1. Compares the current OpenAPI document with a compatibility baseline.
2. Stops before code generation when it finds a breaking change.
3. Regenerates the React Query client and Zod schemas.
4. Fails if the generated files are not committed, so the contract and its
   generated consumers stay in sync.

When the check reports a break, keep the failure output in the change
description. It identifies the affected path, operation, parameter, request
body, response, or schema. Also list the corresponding `operationId` and the
server and web consumers that need to change.

## Compatibility baseline and comparison overrides

The checker uses the following baseline rules:

| Situation | Baseline |
| --- | --- |
| The working tree has an OpenAPI change | `HEAD` |
| The OpenAPI file is clean | `HEAD^` |
| There is no readable previous specification | The check is skipped |

The baseline is only the document being compared against. Choosing a
different baseline does **not** approve a breaking change and must not be used
to hide one from validation.

For a deliberate comparison against a release branch, tag, or saved
specification, use one of these explicit overrides:

```sh
# Git ref
pnpm --filter @workspace/api-spec run check:compatibility -- --baseline <git-ref>

# Specification file
pnpm --filter @workspace/api-spec run check:compatibility -- --baseline-file <path>

# Equivalent environment variables for CI or scripts
OPENAPI_COMPATIBILITY_BASELINE=<git-ref> \
  pnpm --filter @workspace/api-spec run check:compatibility

OPENAPI_COMPATIBILITY_BASELINE_FILE=<path> \
  pnpm --filter @workspace/api-spec run check:compatibility
```

`--current-file <path>` is available for comparing a fixture or candidate
document. It is not a way to skip the check for `openapi.yaml`.

## Review path for an intentional breaking change

An intentional break is a versioned contract change, not a compatibility-check
override. It requires an explicit reviewed action in the pull request:

1. **Describe the break.** Include the compatibility-check output, the
   affected paths and `operationId`s, and the request/response schema changes.
   Name every server route, generated client hook, Zod schema, and application
   consumer that is affected.
2. **Choose the rollout boundary.** Add the new API version or versioned route
   in the OpenAPI contract and server implementation. Update
   `info.version` as release metadata, but do not treat that metadata change
   alone as versioning: generated clients still target the same server URL
   unless the route or server boundary changes too.
3. **Document migration and compatibility.** State whether the old contract
   remains available during migration, which clients must upgrade, and when
   the old version can be removed. If the deployment is intentionally
   coordinated and the old contract is removed immediately, record that
   decision and its consumer impact in the pull request.
4. **Get explicit review.** A reviewer responsible for the API contract must
   approve the intentional break and rollout plan. The change must not be
   merged by selecting a newer baseline, setting an environment variable, or
   otherwise making the checker compare against the already-breaking document.
5. **Regenerate after approval.** Run
   `pnpm run validate:api-generated`, commit all generated client and Zod
   changes, and verify that affected operations use the intended version.
   Include the generated-file diff in the review.

If the change is not approved as an intentional versioned break, make it
backward compatible instead. The compatibility check is intentionally run
before code generation so an unreviewed break cannot silently propagate into
generated clients.