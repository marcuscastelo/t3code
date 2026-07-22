# Maintaining the personal fork with Forksmith

Forksmith is the durable control plane for this long-lived fork. It records
the intent and exact lineage of each fork Change, creates reconciliation
obligations when its configured source advances, and makes validation and
publication explicit. Semantic jobs may be handed to an external agent or the
Forksmith macOS app, but Forksmith remains the authority that validates and
accepts the resulting candidate.

## Topology

- `forksmith-nightly-base/current` is the configured Forksmith source snapshot.
- `upstream/main` remains read-only for ordinary Git and upstream contribution
  work; it is not the source configured for this Forksmith repository.
- `origin` is the personal fork remote.
- `forksmith/meta` stores Forksmith metadata and must be modified only through
  Forksmith commands.
- `forksmith/integration` is the managed composition branch.
- `main` is the published mirror of a validated composition, not a branch for
  manual feature merges.

## Inspect before mutating

Run these commands from the repository root:

```sh
forksmith help --json
forksmith inspect --json
forksmith status --json
```

Use the structured `next_actions` in the JSON response. An active run, a
semantic job, missing validation, or a pending approval is a real blocker; do
not bypass it with a direct Git merge or push.

## Reconcile upstream

`plan` is read-only. `check` is the only normal command that refreshes the
configured upstream tracking ref.

```sh
forksmith check --json
forksmith plan --json
forksmith sync --json
forksmith status --json
```

If `sync` creates a semantic job, inspect the returned isolated clone, make a
clean commit there, then submit that exact job with the command Forksmith
returns. Do not edit canonical branches while resolving a job.

## Start and evolve a Change

Register new fork behavior with a stable Change ID and an explicitly named
canonical branch based on the recorded upstream snapshot. The initial range can
be developed on that branch, then preserved as immutable lineage. Subsequent
work happens in a push-disabled draft clone or a semantic-job clone.

For pre-existing branches, use `forksmith change import` or
`forksmith change attach-legacy` so the original commits remain auditable.
Never infer full upstream absorption from a conflict-free merge or an empty
diff; record the behavior-level assessment and follow any approval action.

## Validate and publish

Validation evidence is separate from a successful build. Resolve every
required Change and composition validation action before publication. The only
push-capable command is:

```sh
forksmith publish <run-id> --json
```

Do not push Forksmith-managed branches with Git. The publish command performs
the required lease and evidence checks and updates the configured fork mirror.
