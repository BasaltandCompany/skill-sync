// GitHub access for skill proposals and the review queue. The server holds
// the GitHub token (never the client); every action is attributed to the
// signed-in user who triggered it.

export const GITHUB_TOKEN = process.env.GITHUB_BOT_TOKEN ?? "";
// owner/name derived from the mirror URL when possible.
export const GITHUB_REPO =
  process.env.SKILLS_REPO_GITHUB ??
  (() => {
    const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/.exec(process.env.SKILLS_REPO_URL ?? "");
    return m ? `${m[1]}/${m[2]}` : "";
  })();

export function ghHeaders() {
  if (!GITHUB_TOKEN) throw new Error("GitHub is not configured on the server: GITHUB_BOT_TOKEN is unset");
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function gh<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers: ghHeaders() });
  if (!res.ok) {
    const body = await res.text();
    const err: any = new Error(`GitHub ${res.status} on ${path}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export type Proposal = { pr_url: string; pr_number: number; branch: string; skill_path: string; proposed_by: string };

// Open an attributed PR for a proposed skill file change. Ported from
// bcw-apps `propose_skill_change` (commit 9aeeafa) — same shape, same gate.
export async function openSkillProposal(args: {
  skill_path: string;
  content: string;
  summary: string;
  who: string;
}): Promise<Proposal> {

  const skill_path = String(args.skill_path);
  const content = String(args.content);
  const summary = String(args.summary).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!/^skills\/[a-z0-9-]+\/(SKILL\.md|(references|model-variants)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md)$/.test(skill_path))
    throw new Error(`Invalid skill_path "${skill_path}" — expected skills/<skill-name>/(SKILL.md | references/<file>.md | model-variants/<file>.md)`);
  if (!content.trim()) throw new Error("content is empty — pass the full new file text");
  if (content.length > 300_000) throw new Error("content exceeds 300KB — split the change or edit references instead");
  if (!summary) throw new Error("summary is required (one line)");

  const repo = GITHUB_REPO;
  if (!repo) throw new Error("SKILLS_REPO_GITHUB (or a github.com SKILLS_REPO_URL) is not configured");

  const slug = args.who.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "user";
  const branch = `skill-proposal/${slug}-${Date.now().toString(36)}`;

  const mainRef = await gh(`/repos/${repo}/git/ref/heads/main`);
  await gh(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainRef.object.sha }),
  });
  await gh(`/repos/${repo}/contents/${encodeURIComponent(skill_path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `skill: ${summary} (from ${args.who})`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    }),
  });
  const pr = await gh<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `skill: ${summary} (from ${args.who})`,
      head: branch,
      base: "main",
      body: [
        `Proposed by **${args.who}** via skill-sync MCP \`propose_skill_change\`.`,
        "",
        "CI runs the eval matrix + token budgets on this PR. CODEOWNERS routes review to the owning team;",
        "on merge the change publishes and syncs to every machine.",
      ].join("\n"),
    }),
  });
  return { pr_url: pr.html_url, pr_number: pr.number, branch, skill_path, proposed_by: args.who };
}

// Open PRs on the skills repo — the review queue. v1 shows requested reviewers
// per PR instead of resolving "me" (identity mapping lands in M2).
export async function listOpenPRs() {
  const repo = GITHUB_REPO;
  if (!repo) throw new Error("SKILLS_REPO_GITHUB (or a github.com SKILLS_REPO_URL) is not configured");
  const prs = await gh<any[]>(`/repos/${repo}/pulls?state=open&per_page=50`);
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    html_url: pr.html_url,
    created_at: pr.created_at,
    draft: pr.draft,
  }));
}

export async function submitReview(number_: number, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string, who: string) {
  const repo = GITHUB_REPO;
  if (!repo) throw new Error("SKILLS_REPO_GITHUB (or a github.com SKILLS_REPO_URL) is not configured");
  if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) throw new Error(`Invalid review event "${event}"`);
  const bodyText = body ? `${body}\n\n— ${who} via skill-sync` : `Reviewed by ${who} via skill-sync.`;
  return gh(`/repos/${repo}/pulls/${number_}/reviews`, {
    method: "POST",
    body: JSON.stringify({ event, body: bodyText }),
  });
}
