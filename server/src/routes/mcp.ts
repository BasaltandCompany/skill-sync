import { Elysia } from "elysia";
import { audit, userForBearer } from "../db";
import { getSkill, listSkills, searchSkills } from "../lib/skills";
import { openSkillProposal } from "../lib/github";

// MCP endpoint (stateless Streamable HTTP, JSON responses). No SDK — same
// hand-rolled JSON-RPC pattern bcw-apps uses: initialize / tools/list /
// tools/call only, no session state. Agents authenticate with an OAuth 2.1
// bearer token (see routes/oauth.ts) or a desktop session token.

const SERVER_INFO = { name: "skill-sync", version: "0.1.0" };

const TOOL_DEFS = [
  {
    name: "list_skills",
    description: "List every published skill in the org's skill-sync library, with name, description, and file list.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_skill",
    description:
      "Read a skill's SKILL.md, or one of its other files via `path` (e.g. references/foo.md, model-variants/haiku-4-5.md). Pass the FULL file text back through propose_skill_change to edit it.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Skill name, e.g. 'research'" }, path: { type: "string", description: "Optional file path within the skill" } },
      required: ["name"],
    },
  },
  {
    name: "search_skills",
    description: "Search the skill library by name, description, or body content. Empty query returns everything.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "propose_skill_change",
    description:
      "Propose a change to an org skill: opens an attributed pull request that runs the eval gate (promptfoo across the model matrix + token budgets) and routes to the owning team's reviewers via CODEOWNERS. Use when the user asks to change a skill itself. Pass the FULL new file text, not a diff.",
    inputSchema: {
      type: "object",
      properties: {
        skill_path: { type: "string", description: "Repo-relative path, e.g. skills/research/SKILL.md or skills/references/x.md" },
        content: { type: "string", description: "The complete new file contents (not a diff)" },
        summary: { type: "string", description: "One-line description of the change (becomes the PR title)" },
      },
      required: ["skill_path", "content", "summary"],
    },
  },
];

async function callTool(name: string, args: any, who: string) {
  const text = (t: string) => ({ content: [{ type: "text", text: t }] });
  const teach = (t: string) => ({ isError: true, ...text(t) });
  switch (name) {
    case "list_skills": {
      const skills = await listSkills();
      return text(JSON.stringify({ skills }, null, 2));
    }
    case "get_skill": {
      const file = await getSkill(String(args.name ?? ""), args.path ? String(args.path) : undefined);
      return file ? text(JSON.stringify(file, null, 2)) : teach(`Skill or file not found: ${args.name}${args.path ? "/" + args.path : ""}`);
    }
    case "search_skills": {
      const skills = await searchSkills(String(args.query ?? ""));
      return text(JSON.stringify({ skills }, null, 2));
    }
    case "propose_skill_change": {
      try {
        const pr = await openSkillProposal({
          skill_path: String(args.skill_path ?? ""),
          content: String(args.content ?? ""),
          summary: String(args.summary ?? ""),
          who,
        });
        audit(who, "skill.proposed", { pr_url: pr.pr_url, skill_path: pr.skill_path });
        return text(JSON.stringify(pr, null, 2));
      } catch (e: any) {
        const hint = !process.env.GITHUB_BOT_TOKEN
          ? " Skill proposals are not configured: GITHUB_BOT_TOKEN is unset on the server — tell your admin."
          : "";
        return teach(String(e?.message ?? e) + hint);
      }
    }
    default:
      return teach(`Unknown tool: ${name}`);
  }
}

const rpc = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export const mcpRoutes = () =>
  new Elysia({ name: "mcp" })
    .post("/mcp", async ({ request, set }) => {
      const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)/i)?.[1] ?? "";
      const user = bearer ? userForBearer(bearer) : null;
      if (!user) {
        set.status = 401;
        set.headers["www-authenticate"] = `Bearer resource_metadata="/.well-known/oauth-protected-resource/mcp"`;
        return { error: "unauthorized" };
      }

      let msg: any;
      try {
        msg = await request.json();
      } catch {
        set.status = 400;
        return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
      }
      const { id, method, params } = msg ?? {};

      switch (method) {
        case "initialize":
          return rpc(id, {
            protocolVersion: params?.protocolVersion ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        case "notifications/initialized":
          set.status = 202;
          return null;
        case "ping":
          return rpc(id, {});
        case "tools/list":
          return rpc(id, { tools: TOOL_DEFS });
        case "tools/call": {
          const name = String(params?.name ?? "");
          try {
            const result = await callTool(name, params?.arguments ?? {}, user.email);
            return rpc(id, result);
          } catch (e: any) {
            return rpc(id, { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
          }
        }
        default:
          if (String(method ?? "").startsWith("notifications/")) {
            set.status = 202;
            return null;
          }
          return rpcError(id, -32601, `Method not found: ${method}`);
      }
    })
    .get("/mcp", ({ set }) => {
      set.status = 405;
      return null;
    });
