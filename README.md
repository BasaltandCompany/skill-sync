# skill-sync

Your organization's agent skills, everywhere: a desktop app + server that keep skills in sync
across every machine and agent, gate every change through evals, and let any agent propose
changes back.

**What it does**

- **Org-wide sync** — skills live in a git repo; every machine points at the server. Claude Code
  gets a SessionStart hook + personal skills dir, Cowork syncs natively via the Git marketplace.
- **Eval-gated changes** — every proposed change runs the promptfoo eval matrix (per-model, via
  OpenRouter) + token budgets before merge. See [pipeline/](pipeline/).
- **Capture-back** — any agent with an MCP connection calls `propose_skill_change`; the server
  opens an attributed PR. Team leads review (CODEOWNERS routes it), in-app or on GitHub.
- **Per-model optimization** — self-routing overlays in `skills/*/model-variants/` tailor each
  skill to the model family running it. The pipeline proves they help; evals keep them honest.
- **Feedback loop** (Milestone 2) — agents and humans report friction on skills/MCP/tools; agents
  query it for known fixes before failing the same way twice.

## Monorepo

| Workspace | What |
| --- | --- |
| [server/](server/) | Hono + Drizzle (SQLite): skills API, MCP endpoint (OAuth 2.1), OIDC sign-in, PR proxy |
| [desktop/](desktop/) | Tauri v2 app: sign in, browse skills, install to agents, review PRs |
| [pipeline/](pipeline/) | The eval harness as a drop-in template + reusable GitHub workflows + `skill-sync-eval` CLI |
| [adapters/](adapters/) | Agent install adapters (Claude Code/Desktop, Codex, Cursor, Cowork, ChatGPT) |

## Quick start

```bash
bun install

# server
cd server
SKILLS_REPO_URL=git@github.com:your-org/your-skills.git bun run dev   # :8811
# dev sign-in without an IdP:
ALLOW_DEV_LOGIN=1 OPENROUTER_API_KEY=... SKILLS_REPO_URL=... bun run dev

# desktop
cd desktop && bun run tauri dev   # sign in, install to agents, sync

# adopt the eval pipeline into your skills repo
cp -r pipeline/template/evals your-skills-repo/evals && cp -r pipeline/template/scripts your-skills-repo/scripts
```

### Server environment

| Var | Meaning |
| --- | --- |
| `SKILLS_REPO_URL` | Git URL of the org's skills repo (source of truth) |
| `SKILLS_REPO_GITHUB` | `owner/name` for PRs (derived from the URL when it's a GitHub remote) |
| `GITHUB_BOT_TOKEN` | Server-held token that opens proposal PRs and posts reviews |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Any OIDC provider (Google works) |
| `ALLOW_DEV_LOGIN` | `1` = email-only dev login, no IdP (never in production) |
| `DB_PATH`, `SKILLSYNC_DATA_DIR`, `PORT` | Storage + port (default `:8811`) |

### MCP (for agents)

Point any MCP client at `<server>/mcp`. Standard OAuth 2.1: the client gets a 401 → discovers
RFC 9728 metadata → registers dynamically → your browser opens one consent page (requires being
signed in) → bearer token, auto-refreshed. Tools: `list_skills`, `get_skill`, `search_skills`,
`propose_skill_change`.

## Verification

```bash
bun test                                  # server + adapters suites
cd desktop/src-tauri && cargo check       # Rust side
cd desktop && bunx vite build             # webview build
bash evals/scripts/gate.sh --all          # inside a skills repo that adopted pipeline/template
```

## Security notes

- Skill content is served read-only from the git mirror; the mirror is server-owned and reset to `origin/main`.
- MCP tokens are attributed to the consenting org user; every proposal and review is audited.
- Consent-less MCP access is impossible: consent requires an authenticated session.
- The GitHub token never leaves the server; the desktop app talks to GitHub through it.

## Status

Milestone 1 complete. Milestone 2 (feedback server on the shared DB + team-lead approval
notifications) is specced in the plan doc. Positioning note: Skillsync (YC W26) moves context
between agents; skill-sync governs and improves skills across an org.

## License

MIT — see [LICENSE](LICENSE).
