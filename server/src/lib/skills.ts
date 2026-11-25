// Git-backed skill mirror. The GitHub skills repo is the source of truth;
// the server clones it and serves published skills over API and MCP.
import { $ } from "bun";

export const SKILLS_REPO_URL = process.env.SKILLS_REPO_URL ?? "";
export const DATA_DIR = process.env.SKILLSYNC_DATA_DIR ?? "./.data";

const MIRROR = `${DATA_DIR}/mirror`;
const REFRESH_MS = 60_000;
let lastFetch = 0;

export type Skill = {
  name: string;
  description: string;
  files: string[];
};

async function ensureMirror() {
  if (!SKILLS_REPO_URL) throw new Error("SKILLS_REPO_URL is not configured on the server");
  const exists = await Bun.file(`${MIRROR}/.git/HEAD`).exists();
  if (!exists) {
    await $`git clone -q ${SKILLS_REPO_URL} ${MIRROR}`.quiet();
  } else if (Date.now() - lastFetch > REFRESH_MS) {
    await $`git -C ${MIRROR} fetch -q origin main`.quiet().catch(() => {});
    await $`git -C ${MIRROR} reset -q --hard origin/main`.quiet().catch(() => {});
    lastFetch = Date.now();
  }
}

// Minimal YAML frontmatter parse: top-level scalars only, which is all a
// SKILL.md header needs (name, description, license…). Nested YAML is ignored.
function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i].trim());
    if (!kv) continue;
    const [, key, v] = kv;
    if (v && !">|".includes(v[0])) {
      out[key] = v.replace(/^["']|["']$/g, "").trim();
    } else {
      // Block scalar (>- folded, | literal): fold the indented lines that follow.
      const parts: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+\S/.test(lines[j])) {
        parts.push(lines[j].trim());
        j++;
      }
      i = j - 1;
      out[key] = parts.join(" ");
    }
  }
  return out;
}

function listSkillDirs(): string[] {
  return require("node:fs").readdirSync(`${MIRROR}/skills`).filter((d: string) => !d.startsWith("."));
}

export async function listSkills(): Promise<Skill[]> {
  await ensureMirror();
  const skills: Skill[] = [];
  for (const dir of listSkillDirs()) {
    const file = Bun.file(`${MIRROR}/skills/${dir}/SKILL.md`);
    if (!(await file.exists())) continue;
    const meta = frontmatter(await file.text());
    const entries = await Array.fromAsync(new Bun.Glob(`**/*.md`).scan({ cwd: `${MIRROR}/skills/${dir}` }));
    skills.push({
      name: meta.name ?? dir,
      description: meta.description ?? "",
      files: entries.sort(),
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(name: string, path?: string): Promise<{ path: string; content: string } | null> {
  await ensureMirror();
  const rel = path ? `skills/${name}/${path.replace(/^\/+/, "")}` : `skills/${name}/SKILL.md`;
  // Path traversal guard: the resolved path must stay inside the skill dir.
  const resolved = require("node:path").resolve(`${MIRROR}/${rel}`);
  if (!resolved.startsWith(require("node:path").resolve(`${MIRROR}/skills/${name}`) + "/")) return null;
  const file = Bun.file(resolved);
  if (!(await file.exists())) return null;
  return { path: rel, content: await file.text() };
}

export async function searchSkills(query: string): Promise<Skill[]> {
  const q = query.toLowerCase().trim();
  if (!q) return listSkills();
  const skills = await listSkills();
  const hits: { skill: Skill; score: number }[] = [];
  for (const skill of skills) {
    const nameHit = skill.name.toLowerCase().includes(q);
    const descHit = skill.description.toLowerCase().includes(q);
    let bodyHit = false;
    if (!nameHit && !descHit) {
      const file = await getSkill(skill.name);
      bodyHit = !!file && file.content.toLowerCase().includes(q);
    }
    if (nameHit || descHit || bodyHit) hits.push({ skill, score: (nameHit ? 2 : 0) + (descHit || bodyHit ? 1 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score).map((h) => h.skill);
}
