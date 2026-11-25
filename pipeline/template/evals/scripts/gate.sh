#!/usr/bin/env bash
# The CI gate, runnable locally — the workflows call this same script.
#
# Local:  OPENROUTER_API_KEY=sk-or-... bun evals/scripts/gate.sh
# Full matrix + fixture self-test (what publish runs):
#         OPENROUTER_API_KEY=sk-or-... bun evals/scripts/gate.sh --all
#   PROMPTFOO_API_KEY (optional, env or CI secret): set it and every eval run
#   uploads to your private promptfoo org (app.promptfoo.dev) for cross-run
#   comparison; the PR comment links each run. Unset = local-only, never an
#   anonymous public share link.
# Options:
#   --all          eval every skill + run the broken-fixture self-test
#   --base <ref>   diff base for changed-skill detection (default origin/main)
#
# Behavior:
#   - static checks (token budgets + variant routing) always run
#   - PR mode evals only skills whose files changed (all of them when only
#     evals/ changed); --all runs everything
#   - evals run through run-evals.sh (transient retry, credit classification)
#   - with GITHUB_TOKEN + GITHUB_PR set, results are posted as a PR comment;
#     without them the summary prints to stdout (local mode)
# Exit codes: 0 green · 1 eval failures · 42 credits/transient (see run-evals.sh)
set -uo pipefail
cd "$(dirname "$0")/../.."

ALL=0
BASE="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1 ;;
    --base) BASE="${2:-}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "::error::OPENROUTER_API_KEY is not set (locally: export it; in CI: repo secret)."
  exit 1
fi

echo "== static checks (budgets + variant routing) =="
bun evals/scripts/check-budgets.mjs || exit 1
bun scripts/check-variants.mjs || exit 1

ALL_SKILLS=$(ls evals | grep -v -e fixtures -e scripts -e shared -e budgets.json -e model-matrix.json -e README.md)
if [ "$ALL" -eq 1 ]; then
  SKILLS="$ALL_SKILLS"
else
  git fetch -q origin main 2>/dev/null || true
  CHANGED=$(git diff --name-only "$BASE"...HEAD 2>/dev/null || true)
  echo "== changed files (vs $BASE) =="
  echo "$CHANGED"
  SKILLS=$(echo "$CHANGED" | sed -n 's|^skills/\([^/]*\)/.*|\1|p' | sort -u)
  # evals-only changes must still be validated — against every skill
  [ -z "$SKILLS" ] && SKILLS="$ALL_SKILLS"
fi

FINAL=""
for s in $SKILLS; do [ -f "evals/$s/promptfooconfig.yaml" ] && FINAL="$FINAL $s"; done
echo "== evaluating:${FINAL:- (none)} =="
[ -z "$FINAL" ] && exit 0

chmod +x evals/scripts/run-evals.sh
mkdir -p results
FAIL=0
for s in $FINAL; do
  echo "=== evals/$s ==="
  rc=0
  evals/scripts/run-evals.sh "evals/$s/promptfooconfig.yaml" "results/$s.json" || rc=$?
  if [ "$rc" -eq 42 ]; then
    echo "::error::Gate stopped early on provider credits/transient errors — NOT an eval regression. Top up OpenRouter and re-run; cached responses make the re-run cheap."
    [ -n "${GITHUB_ACTIONS:-}" ] && exit 1 || exit 42
  fi
  [ "$rc" -ne 0 ] && FAIL=1
done

if [ "$ALL" -eq 1 ]; then
  echo "=== fixture self-test (must FAIL) ==="
  rc=0
  evals/scripts/run-evals.sh evals/fixtures/broken-skill/promptfooconfig.yaml results-fixture.json || rc=$?
  if [ "$rc" -eq 42 ]; then
    echo "::error::Fixture self-test blocked by provider credits/transient errors — re-run after topping up."
    [ -n "${GITHUB_ACTIONS:-}" ] && exit 1 || exit 42
  fi
  if [ "$rc" -eq 0 ]; then
    echo "::error::The broken-skill fixture PASSED — the gate can no longer gate. Fix the harness before publishing."
    exit 1
  fi
  bun -e "
    const r = require('./results-fixture.json');
    const s = r.results?.stats ?? {};
    if (((s.failures ?? 0) + (s.errors ?? 0)) === 0) {
      console.error('Fixture exited non-zero but recorded no failures — infrastructure, not a pass.');
      process.exit(1);
    }
    console.log('Fixture correctly rejected (' + (s.failures ?? 0) + ' failing). The pipeline can fail.');
  " || FAIL=1
fi

echo "== results summary =="
rc=0
bun evals/scripts/pr-comment.mjs results || rc=$?
[ "$rc" -ne 0 ] && FAIL=1
exit $FAIL
