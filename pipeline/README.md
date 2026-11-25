# skill-sync eval pipeline

The eval gate from the BCW skill-optimization work (bcw-hub-plugin PR #1), extracted so **any
org's skills repo** can adopt it with one copy operation and one workflow file:

- **promptfoo evals** across the model matrix (Sonnet 4.5 / Opus 4.5 / Haiku 4.5 via OpenRouter — one key covers every vendor)
- **token budgets** — bytes/4 estimate ratchet, add-only via `--init`
- **variant routing checks** — self-routing per-model overlays (`skills/*/model-variants/`) verified structurally; behaviorally verified by the evals themselves
- **broken-fixture self-test** — a deliberately broken skill whose suite must FAIL, so the gate can never silently stop gating
- **PR comment + merge block** — results land on the PR; a red gate blocks merge
- **merge = publish** — full matrix on main, then optional version bump + tag; rollback = git revert

## Adopting (any skills repo)

Your repo needs this layout (the template assumes it):

```
skills/<skill-name>/SKILL.md        (+ references/, model-variants/ as needed)
evals/<skill-name>/promptfooconfig.yaml
evals/scripts/                      ← copy from template/evals/scripts
evals/shared/                       ← copy from template/evals/shared
evals/model-matrix.json             ← copy; edit provider slugs to taste
evals/budgets.json                  ← starts as {}; seed with --init
scripts/check-variants.mjs          ← copy from template/scripts
```

```bash
# 1. copy the harness in
cp -r <skill-sync>/pipeline/template/evals .
cp -r <skill-sync>/pipeline/template/scripts .

# 2. seed budgets for every current file (current bytes × 1.1, add-only)
bun evals/scripts/check-budgets.mjs --init

# 3. write golden cases per skill (see evals/example-report-publishing)

# 4. add the caller workflows (below) and set repo secrets:
#    OPENROUTER_API_KEY (required), PROMPTFOO_API_KEY (optional, for the visualizer)
```

### Caller workflows (in your repo, `.github/workflows/`)

```yaml
name: skill-evals
on:
  pull_request:
    paths: ['skills/**', 'evals/**']
jobs:
  gate:
    uses: basaltandcompany/skill-sync/.github/workflows/skill-evals.yml@main
    secrets: inherit
```

```yaml
name: publish
on:
  push:
    branches: [main]
    paths: ['skills/**', 'evals/**']
jobs:
  publish:
    uses: basaltandcompany/skill-sync/.github/workflows/skill-publish.yml@main
    secrets: inherit
    with:
      version_file: 'plugin.json'   # any JSON with a "version" key; omit for gate-only
```

### Nightly full-matrix sweep (optional, off by default)

```yaml
on:
  schedule:
    - cron: '0 6 * * *'   # daily 06:00 UTC; delete this job if too expensive
jobs:
  sweep:
    uses: basaltandcompany/skill-sync/.github/workflows/skill-publish.yml@main
    secrets: inherit      # version_file omitted → gate only, no release
```

## Local runs

```bash
OPENROUTER_API_KEY=sk-or-... bash evals/scripts/gate.sh            # changed skills only
OPENROUTER_API_KEY=sk-or-... bash evals/scripts/gate.sh --all      # everything + fixture self-test
bun evals/scripts/check-budgets.mjs --init                         # re-seed budgets after adding files
```

or, via the CLI wrapper (same script, nicer name): `bunx @skill-sync/eval-cli --all`

## Exit codes

- `0` green · `1` eval failures (or missing budget) · `42` provider credits/transient — NOT a regression; re-run, cached responses make it cheap.

## Provenance

Ported verbatim from `BCW-Supplies/bcw-hub-plugin` (PR #1, merged 2026-11) with only two
generalizations: example/fixture skills rewritten to be org-agnostic, and the publish
workflow's version file made an input.
