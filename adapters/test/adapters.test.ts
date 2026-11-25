import { installMcp, mcpConfigPath, syncSkillsToClaudeCode, type SkillPayload } from "../src";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ss-adapters-"));
});

test("mcp config paths", () => {
  expect(mcpConfigPath("claude-code", "/h")).toBe("/h/.claude.json");
  expect(mcpConfigPath("cursor", "/h")).toBe("/h/.cursor/mcp.json");
  expect(mcpConfigPath("codex", "/h")).toBe(null);
});

test("claude-code gets a native remote MCP entry, idempotent", async () => {
  const r1 = await installMcp("claude-code", { serverUrl: "https://skills.example.com/", home });
  expect(r1.ok).toBe(true);
  const cfg = JSON.parse(readFileSync(`${home}/.claude.json`, "utf8"));
  expect(cfg.mcpServers["skill-sync"].url).toBe("https://skills.example.com/mcp");

  // second run overwrites, doesn't duplicate; other keys preserved
  cfg.mcpServers.other = { command: "foo" };
  writeFileSync(`${home}/.claude.json`, JSON.stringify(cfg));
  await installMcp("claude-code", { serverUrl: "https://skills.example.com", home });
  const again = JSON.parse(readFileSync(`${home}/.claude.json`, "utf8"));
  expect(Object.keys(again.mcpServers).sort()).toEqual(["other", "skill-sync"]);
  expect(existsSync(`${home}/.claude.json.bak`)).toBe(true);
});

test("claude-desktop bridges with mcp-remote", async () => {
  const r = await installMcp("claude-desktop", { serverUrl: "https://skills.example.com", home });
  expect(r.ok).toBe(true);
  const cfg = JSON.parse(readFileSync(`${home}/Library/Application Support/Claude/claude_desktop_config.json`, "utf8"));
  expect(cfg.mcpServers["skill-sync"].command).toBe("npx");
  expect(cfg.mcpServers["skill-sync"].args).toContain("--oauth");
});

test("cursor gets an HTTP entry", async () => {
  await installMcp("cursor", { serverUrl: "https://skills.example.com", home });
  const cfg = JSON.parse(readFileSync(`${home}/.cursor/mcp.json`, "utf8"));
  expect(cfg.mcpServers["skill-sync"].url).toBe("https://skills.example.com/mcp");
});

test("codex gets a TOML block, idempotent", async () => {
  await installMcp("codex", { serverUrl: "https://skills.example.com", home });
  await installMcp("codex", { serverUrl: "https://skills2.example.com", home });
  const toml = readFileSync(`${home}/.codex/config.toml`, "utf8");
  expect((toml.match(/\[mcp_servers\.skill-sync\]/g) ?? []).length).toBe(1);
  expect(toml).toContain('url = "https://skills2.example.com/mcp"');
});

test("cowork and chatgpt return notes, not files", async () => {
  expect((await installMcp("cowork", { serverUrl: "x", home })).note).toContain("marketplace");
  expect((await installMcp("chatgpt", { serverUrl: "x", home })).note).toContain("connector");
});

const SKILL: SkillPayload = {
  name: "demo",
  files: [
    { path: "SKILL.md", content: "# Demo v1" },
    { path: "references/x.md", content: "extra" },
  ],
};

test("skill sync writes trees and is idempotent", async () => {
  const [r1] = await syncSkillsToClaudeCode([SKILL], { home });
  expect(r1.ok).toBe(true);
  expect(readFileSync(`${home}/.claude/skills/demo/SKILL.md`, "utf8")).toBe("# Demo v1");
  const [r2] = await syncSkillsToClaudeCode([SKILL], { home });
  expect(r2.note).toContain("up to date");
});

test("drift guard never clobbers local edits", async () => {
  await syncSkillsToClaudeCode([SKILL], { home });
  const fp = `${home}/.claude/skills/demo/SKILL.md`;
  writeFileSync(fp, "# my local edits"); // human edit, not seen by the state file
  const [r] = await syncSkillsToClaudeCode([{ ...SKILL, files: [{ path: "SKILL.md", content: "# Demo v2" }] }], { home });
  expect(readFileSync(fp, "utf8")).toBe("# my local edits"); // untouched
  expect(r.note).toContain("left untouched");
  // ...but an identical re-write is not drift
  writeFileSync(fp, "# Demo v1");
  const [again] = await syncSkillsToClaudeCode([SKILL], { home });
  expect(again.note).toContain("up to date");
});

test("traversal paths are rejected", async () => {
  mkdirSync(`${home}/.claude/skills`, { recursive: true });
  const [r] = await syncSkillsToClaudeCode(
    [{ name: "evil", files: [{ path: "../../.ssh/authorized_keys", content: "boom" }] }],
    { home }
  );
  expect(r.ok).toBe(false);
  expect(existsSync(`${home}/.ssh`)).toBe(false);
});
