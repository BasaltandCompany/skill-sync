// Agent adapters: wire a skill-sync server into each agent host. Pure TS with
// injectable homeDir + fs so the same code runs in tests (node), CLIs, and the
// Tauri webview (plugin-fs). Every JSON config edit writes a sibling .bak —
// these are the user's real config files.

export type AgentId = "claude-code" | "claude-desktop" | "codex" | "cursor" | "cowork" | "chatgpt";

export type AdapterResult = { ok: boolean; path?: string; note?: string };

export type SkillFile = { path: string; content: string };
export type SkillPayload = { name: string; files: SkillFile[] };

export type FsLike = {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
};

/** node:fs default impl (tests, CLIs). The desktop app passes the Tauri fs. */
export function nodeFs(): FsLike {
  const fs = require("node:fs");
  return {
    readTextFile: (p) => new Promise((res) => fs.readFile(p, "utf8", (e: any, d: string) => res(e ? null : d))),
    writeTextFile: (p, c) => fs.promises.writeFile(p, c, "utf8"),
    mkdir: (p, o) => fs.promises.mkdir(p, { recursive: true }).then(() => undefined),
    exists: (p) => fs.promises.access(p).then(() => true, () => false),
  };
}

export type InstallOpts = { serverUrl: string; home: string; fs?: FsLike };

const SERVER_NAME = "skill-sync";

async function backup(fs: FsLike, fp: string) {
  const raw = await fs.readTextFile(fp);
  if (raw !== null) await fs.writeTextFile(fp + ".bak", raw);
}

async function readJson(fs: FsLike, fp: string): Promise<any> {
  const raw = await fs.readTextFile(fp);
  if (raw === null) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeJson(fs: FsLike, fp: string, value: any) {
  await fs.mkdir(fp.slice(0, fp.lastIndexOf("/")), { recursive: true });
  await backup(fs, fp);
  await fs.writeTextFile(fp, JSON.stringify(value, null, 2) + "\n");
}

function upsertMcpServer(config: any, serverUrl: string) {
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers[SERVER_NAME] = { url: `${serverUrl.replace(/\/$/, "")}/mcp` };
  return config;
}

/** User-level MCP config paths per agent. */
export function mcpConfigPath(agent: AgentId, home: string): string | null {
  switch (agent) {
    case "claude-code":
      return `${home}/.claude.json`;
    case "claude-desktop":
      // macOS primary; XDG builds differ but this path is what the app reads.
      return `${home}/Library/Application Support/Claude/claude_desktop_config.json`;
    case "cursor":
      return `${home}/.cursor/mcp.json`;
    default:
      return null;
  }
}

async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Register the skill-sync MCP server with an agent.
 * - claude-code / cursor: native remote MCP (HTTP) entry, OAuth discovered via RFC 9728.
 * - claude-desktop: stdio-only → bridges via `mcp-remote --oauth`.
 * - codex: TOML block in ~/.codex/config.toml.
 * - cowork / chatgpt: not file-configurable — returns setup notes instead.
 */
export async function installMcp(agent: AgentId, opts: InstallOpts): Promise<AdapterResult> {
  const fs = opts.fs ?? nodeFs();
  const serverUrl = opts.serverUrl.replace(/\/$/, "");
  switch (agent) {
    case "claude-code":
    case "cursor": {
      const fp = mcpConfigPath(agent, opts.home)!;
      await writeJson(fs, fp, upsertMcpServer(await readJson(fs, fp), serverUrl));
      return { ok: true, path: fp };
    }
    case "claude-desktop": {
      const fp = mcpConfigPath(agent, opts.home)!;
      const config = await readJson(fs, fp);
      config.mcpServers = config.mcpServers ?? {};
      config.mcpServers[SERVER_NAME] = { command: "npx", args: ["-y", "mcp-remote", `${serverUrl}/mcp`, "--oauth"] };
      await writeJson(fs, fp, config);
      return { ok: true, path: fp };
    }
    case "codex": {
      const fp = `${opts.home}/.codex/config.toml`;
      await fs.mkdir(fp.slice(0, fp.lastIndexOf("/")), { recursive: true });
      await backup(fs, fp);
      const toml = ((await fs.readTextFile(fp)) ?? "")
        // Idempotent: drop any previous block, then append.
        .replace(new RegExp(`\\[mcp_servers\\.${SERVER_NAME}\\][^\\[]*`, "g"), "")
        .replace(/\n{3,}/g, "\n\n");
      await fs.writeTextFile(fp, `${toml}\n[mcp_servers.${SERVER_NAME}]\nurl = "${serverUrl}/mcp"\n`);
      return { ok: true, path: fp };
    }
    case "cowork":
      return {
        ok: false,
        note: "Cowork installs Git-marketplace plugins with automatic org-wide sync (admins can force-install). Add the skills repo as a marketplace plugin in Cowork settings; no local config file to write.",
      };
    case "chatgpt":
      return { ok: false, note: "ChatGPT has no local skills dir; use the MCP connector where your plan supports it and point it at the same server URL." };
  }
}

/** State file for drift detection, per installed skill. */
function stateFile(home: string, skill: string) {
  return `${home}/.claude/skills/${skill}/.skill-sync-state.json`;
}

async function readState(fs: FsLike, home: string, skill: string): Promise<Record<string, string>> {
  const raw = await fs.readTextFile(stateFile(home, skill));
  if (raw === null) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Sync skill folders into Claude Code's personal skills dir. Drift guard
 * (same rule as the bcw sync.sh hook): if a file differs from what we last
 * wrote, someone edited it locally — leave it and point at the propose flow.
 */
export async function syncSkillsToClaudeCode(skills: SkillPayload[], opts: { home: string; fs?: FsLike }): Promise<AdapterResult[]> {
  const fs = opts.fs ?? nodeFs();
  const results: AdapterResult[] = [];
  for (const skill of skills) {
    const dir = `${opts.home}/.claude/skills/${skill.name}`;
    await fs.mkdir(dir, { recursive: true });
    const state = await readState(fs, opts.home, skill.name);

    let drifted = false;
    for (const file of skill.files) {
      // Path guard: every file must land inside this skill's directory.
      if (file.path.includes("..") || file.path.startsWith("/")) {
        results.push({ ok: false, note: `${skill.name}: unsafe path ${file.path}` });
        drifted = true;
        continue;
      }
      const fp = `${dir}/${file.path}`;
      const onDisk = await fs.readTextFile(fp);
      if (onDisk !== null && onDisk !== file.content && state[file.path] !== (await sha256hex(onDisk))) {
        // Locally modified since our last write — never clobber.
        drifted = true;
        continue;
      }
      await fs.mkdir(fp.slice(0, fp.lastIndexOf("/")), { recursive: true });
      await fs.writeTextFile(fp, file.content);
      state[file.path] = await sha256hex(file.content);
    }
    await fs.writeTextFile(stateFile(opts.home, skill.name), JSON.stringify(state, null, 2));
    results.push({
      ok: true,
      path: dir,
      note: drifted
        ? `${skill.name}: synced, but some local edits were left untouched — propose them via the skill-sync MCP propose_skill_change tool`
        : `${skill.name}: up to date (${skill.files.length} files)`,
    });
  }
  return results;
}

export const AGENT_NOTES: Record<AgentId, string> = {
  "claude-code": "Remote MCP + personal skills dir (~/.claude/skills), SessionStart-hook sync optional.",
  "claude-desktop": "Bridged over stdio with mcp-remote --oauth.",
  codex: "MCP URL block in ~/.codex/config.toml.",
  cursor: "Remote MCP entry in ~/.cursor/mcp.json.",
  cowork: "Git-marketplace plugin with native org auto-sync; admins can force-install.",
  chatgpt: "MCP connector where the plan supports it.",
};
