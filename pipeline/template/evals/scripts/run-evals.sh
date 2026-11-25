#!/usr/bin/env bash
# Run one promptfoo config with transient-error retry and credit classification.
#
# Usage: run-evals.sh <config.yaml> <output.json> [concurrency]
#
# Exit codes:
#   0  — all green
#   1  — real eval failures (or config error) — the gate should fail
#   42 — provider credits/quota exhausted or transient errors persisted after
#        retries — NOT an eval regression; the caller should stop cleanly
#        with a clear message instead of posting misleading results.
#
# Why scan the results file too: OpenRouter credit exhaustion surfaces as an
# error STRING inside individual test outputs (the request never completes),
# so a "2 failed" run can actually be a billing problem. Successful responses
# are cached by promptfoo, so a retry after a top-up only re-calls what failed.
set -uo pipefail

CONFIG="$1"
OUT="$2"
J="${3:-6}"

TRANSIENT='(would exceed|credit balance|insufficient|payment required|402|429|rate.?limit|quota|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|50[023]|overloaded|529)'
CREDIT='(would exceed|credit balance|insufficient|payment required|402)'

# Private cloud upload: with PROMPTFOO_API_KEY set, --share uploads this run
# to your promptfoo org's visualizer (app.promptfoo.dev) and stamps a
# shareableUrl into $OUT. Without the key we never pass --share — an
# anonymous share link would be publicly reachable and these evals carry
# the organization's business context.
SHARE=""
[ -n "${PROMPTFOO_API_KEY:-}" ] && SHARE="--share"
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

last_rc=1
for ATTEMPT in 1 2 3; do
  echo "::group::promptfoo ${CONFIG} (attempt ${ATTEMPT})"
  bun x promptfoo@latest eval -c "$CONFIG" -o "$OUT" -j "$J" $SHARE >"$LOG" 2>&1
  last_rc=$?
  echo "::endgroup::"
  [ "$last_rc" -eq 0 ] && exit 0

  # Provider errors can live in the log OR inside individual result outputs.
  HAY="$LOG"
  [ -f "$OUT" ] && HAY="$HAY
$(cat "$OUT")"

  if grep -qiE "$CREDIT" <<<"$HAY"; then
    if [ "$ATTEMPT" -lt 2 ]; then
      echo "provider credits/quota error on attempt ${ATTEMPT} — one retry in 45s in case a top-up lands"
      sleep 45
      continue
    fi
    echo "::error::Provider credits/quota exhausted while running ${CONFIG}. This is NOT an eval regression — top up the OpenRouter key and re-run this job."
    exit 42
  fi

  if grep -qiE "$TRANSIENT" <<<"$HAY"; then
    if [ "$ATTEMPT" -lt 3 ]; then
      echo "transient provider error on attempt ${ATTEMPT} — retrying in 30s"
      sleep 30
      continue
    fi
    echo "::error::Transient provider errors persisted after 3 attempts on ${CONFIG}. Not an eval regression — re-run the job."
    exit 42
  fi

  # Non-transient: real failures — show the tail for the run log.
  tail -n 40 "$LOG"
  exit "$last_rc"
done
exit 42
