#!/usr/bin/env bash

set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

require_phrase() {
  local file="$1"
  local text="$2"
  local normalized

  normalized="$(LC_ALL=C tr '\n\t' '  ' < "$file" | tr -s ' ')"
  if [[ "$normalized" != *"$text"* ]]; then
    printf 'missing Forksmith adoption contract in %s: %s\n' "$file" "$text" >&2
    return 1
  fi
}

require_phrase AGENTS.md 'Forksmith as the durable authority for reconciliation'
require_phrase AGENTS.md '`forksmith-nightly-base/current` source'
require_phrase AGENTS.md 'Only `forksmith publish <run-id>` may publish Forksmith-managed refs'
require_phrase AGENTS.md 'push-disabled Forksmith draft or semantic-job clone'

require_phrase README.md 'its intent, validation evidence, and the reconciliation plan'
require_phrase README.md '`forksmith inspect --json` and `forksmith status --json` before fork maintenance'
require_phrase README.md 'Only `forksmith publish <run-id>` may publish managed refs'

require_phrase docs/operations/forksmith.md '`upstream/main` remains read-only'
require_phrase docs/operations/forksmith.md '`plan` is read-only'
require_phrase docs/operations/forksmith.md 'semantic-job clone'
require_phrase docs/operations/forksmith.md 'submit that exact job with the command Forksmith returns'
require_phrase docs/operations/forksmith.md 'intent and exact lineage of each fork Change'
require_phrase docs/operations/forksmith.md 'Validation evidence is separate from a successful build'
require_phrase docs/operations/forksmith.md 'The only push-capable command is:'
require_phrase docs/operations/forksmith.md 'forksmith publish <run-id> --json'

printf 'Forksmith adoption documentation contract passed.\n'
