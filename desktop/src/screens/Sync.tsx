import { createSignal, For, Show } from "solid-js";
import { getConfig, getSkillFile, listSkills } from "../lib/api";
import { isTauri } from "../lib/tauri";
import { installMcp, syncSkillsToClaudeCode, type AgentId } from "@skill-sync/adapters";
import { home, tauriFs } from "../lib/tauriFs";
import { Button } from "@basaltac/ui";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "cowork", label: "Cowork" },
  { id: "chatgpt", label: "ChatGPT" },
];

function serverOrigin() {
  return localStorage.getItem("skill_sync_server") ?? "http://localhost:8811";
}

export default function Sync() {
  const [results, setResults] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [githubRepo, setGithubRepo] = createSignal<string | null>(null);

  getConfig().then((c) => setGithubRepo(c.repo)).catch(() => {});

  async function install(agent: AgentId) {
    if (!isTauri) {
      setResults((prev) => [`${agent}: file installs need the desktop app (bun run tauri dev)`, ...prev]);
      return;
    }
    setBusy(true);
    try {
      const r = await installMcp(agent, {
        serverUrl: serverOrigin(),
        home: await home(),
        fs: tauriFs,
      });
      setResults((prev) => [`${agent}: ${r.note ?? (r.ok ? `installed → ${r.path}` : "failed")}`, ...prev]);
    } catch (e: any) {
      setResults((prev) => [`${agent}: ${e.message}`, ...prev]);
    } finally {
      setBusy(false);
    }
  }

  async function syncSkills() {
    if (!isTauri) {
      setResults((prev) => ["skills: file sync needs the desktop app (bun run tauri dev)", ...prev]);
      return;
    }
    setBusy(true);
    try {
      const { skills } = await listSkills();
      const payloads = await Promise.all(
        skills.map(async (s) => ({
          name: s.name,
          files: await Promise.all(
            s.files.map(async (f) => {
              const file = await getSkillFile(s.name, f);
              return { path: f, content: file.content };
            })
          ),
        }))
      );
      const rs = await syncSkillsToClaudeCode(payloads, { home: await home(), fs: tauriFs });
      setResults((prev) => [...rs.map((r) => `claude-code skills: ${r.note}`), ...prev]);
    } catch (e: any) {
      setResults((prev) => [`skills: ${e.message}`, ...prev]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="max-w-2xl p-8">
      <h1 class="font-heading text-lg">Sync</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Point your agents at the skill-sync server and pull the current skills onto this machine.
      </p>

      <section class="mt-6">
        <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent adapters</h2>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <For each={AGENTS}>
            {(a) => (
              <Button variant="outline" class="justify-start" disabled={busy()} onClick={() => install(a.id)}>
                {a.label}
              </Button>
            )}
          </For>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          Cowork syncs via the Git marketplace{githubRepo() ? ` (${githubRepo()})` : ""}; ChatGPT via MCP connector.
        </p>
      </section>

      <section class="mt-8">
        <Button disabled={busy()} onClick={syncSkills}>
          {busy() ? "Working…" : "Sync skills to this machine"}
        </Button>
        <p class="mt-2 text-xs text-muted-foreground">
          Writes into ~/.claude/skills. Local edits are never overwritten — propose them instead.
        </p>
      </section>

      <Show when={results().length > 0}>
        <section class="mt-8">
          <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</h2>
          <ul class="mt-2 space-y-1">
            <For each={results()}>
              {(r) => (
                <li class="bg-card px-3 py-2 font-mono text-xs text-muted-foreground">{r}</li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
