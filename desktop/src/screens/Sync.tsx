import { useEffect, useState } from "react";
import { getConfig, getSkillFile, listSkills } from "../lib/api";
import { installMcp, syncSkillsToClaudeCode, type AgentId } from "@skill-sync/adapters";
import { home, tauriFs } from "../lib/tauriFs";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "cowork", label: "Cowork" },
  { id: "chatgpt", label: "ChatGPT" },
];

export default function Sync() {
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then((c) => setGithubRepo(c.repo)).catch(() => {});
  }, []);

  async function install(agent: AgentId) {
    setBusy(true);
    try {
      const r = await installMcp(agent, { serverUrl: location.origin === "null" ? localStorage.getItem("skill_sync_server") ?? "" : serverOrigin(), home: await home(), fs: tauriFs });
      setResults((prev) => [`${agent}: ${r.note ?? (r.ok ? `installed → ${r.path}` : "failed")}`, ...prev]);
    } catch (e: any) {
      setResults((prev) => [`${agent}: ${e.message}`, ...prev]);
    } finally {
      setBusy(false);
    }
  }

  // In the packaged app, same-origin IS the server only if self-hosted together;
  // read the configured server URL instead.
  function serverOrigin() {
    return localStorage.getItem("skill_sync_server") ?? "http://localhost:8811";
  }

  async function syncSkills() {
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
    <div className="p-8">
      <h1 className="text-lg font-semibold">Sync</h1>
      <p className="mt-1 text-sm text-basalt-400">
        Point your agents at the skill-sync server and pull the current skills onto this machine.
      </p>

      <section className="mt-6">
        <h2 className="text-xs font-medium tracking-wide text-basalt-400 uppercase">Agent adapters</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              disabled={busy}
              onClick={() => install(a.id)}
              className="rounded-lg border border-basalt-700 bg-basalt-900 px-3 py-2 text-left text-sm hover:border-basalt-accent disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-basalt-400">
          Cowork syncs via the Git marketplace{githubRepo ? ` (${githubRepo})` : ""}; ChatGPT via MCP connector.
        </p>
      </section>

      <section className="mt-8">
        <button
          onClick={syncSkills}
          disabled={busy}
          className="rounded-lg bg-basalt-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          Sync skills to this machine
        </button>
        <p className="mt-2 text-xs text-basalt-400">Writes into ~/.claude/skills. Local edits are never overwritten — propose them instead.</p>
      </section>

      {results.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium tracking-wide text-basalt-400 uppercase">Activity</h2>
          <ul className="mt-2 space-y-1">
            {results.map((r, i) => (
              <li key={i} className="rounded-md bg-basalt-900 px-3 py-2 font-mono text-xs text-basalt-200">
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
