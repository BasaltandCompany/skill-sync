// End-to-end server test, no network: dev-login session → OAuth 2.1 (DCR →
// PKCE consent → token) → MCP tools → API — against a local fixture skills repo.

process.env.DB_PATH = `${import.meta.dir}/../.test-data/test.db`;
process.env.SKILLSYNC_DATA_DIR = `${import.meta.dir}/../.test-data`;
process.env.ALLOW_DEV_LOGIN = "1";
// SKILLS_REPO_URL points at a local file:// fixture repo created in beforeAll.

const { execSync } = await import("node:child_process");
import path from "node:path";

let app: any;
let repoUrl = "";

beforeAll(async () => {
  const tmp = `${import.meta.dir}/../.test-data/fixture-skills-repo`;
  execSync(`rm -rf "${tmp}" "${import.meta.dir}/../.test-data/mirror" "${import.meta.dir}/../.test-data/test.db"*`);
  execSync(`mkdir -p "${tmp}/skills/demo/references" "${tmp}/skills/broken"`);
  execSync(`cd "${tmp}" && git init -q && git config user.email t@t && git config user.name t`);
  await Bun.write(
    `${tmp}/skills/demo/SKILL.md`,
    `---\nname: demo\ndescription: >-\n  A demo skill for tests\n---\n\n# Demo\n\nHello from the demo skill.`
  );
  await Bun.write(`${tmp}/skills/demo/references/extra.md`, "# Extra\n\nReference text.");
  await Bun.write(`${tmp}/skills/broken/SKILL.md`, "# no frontmatter\n");
  execSync(`cd "${tmp}" && git add -A && git commit -qm init`);
  repoUrl = `file://${tmp}`;
  process.env.SKILLS_REPO_URL = repoUrl;

  const { default: index } = await import("../src/index");
  void index;
  const mod = await import("../src/app");
  app = mod.app;
});

afterAll(() => {
  execSync(`rm -rf "${import.meta.dir}/../.test-data"`);
});

let cookie = "";

test("dev login issues a session", async () => {
  const res = await app.handle(new Request("http://localhost:8811/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "tester@basalt.dev", next: "/" }).toString(),
    redirect: "manual",
  }));
  expect(res.status).toBe(302);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  expect(cookie).toContain("skill_sync_session=");
});

test("/auth/me resolves the session", async () => {
  const res = await app.handle(new Request("http://localhost:8811/auth/me", { headers: { cookie } }));
  expect(res.status).toBe(200);
  const me = await res.json();
  expect(me.email).toBe("tester@basalt.dev");
});

test("API lists skills from the git mirror", async () => {
  const res = await app.handle(new Request("http://localhost:8811/api/skills", { headers: { cookie } }));
  expect(res.status).toBe(200);
  const { skills } = await res.json();
  const demo = skills.find((s: any) => s.name === "demo");
  expect(demo.description).toBe("A demo skill for tests");
  expect(demo.files).toContain("SKILL.md");
  expect(demo.files).toContain("references/extra.md");
});

test("get_skill serves file contents and blocks path traversal", async () => {
  const ok = await app.handle(new Request(`http://localhost:8811/api/skills/demo?path=${encodeURIComponent("references/extra.md")}`, { headers: { cookie } }));
  expect((await ok.json()).content).toContain("Reference text.");
  const bad = await app.handle(new Request(`http://localhost:8811/api/skills/demo?path=${encodeURIComponent("../../db/index.ts")}`, { headers: { cookie } }));
  expect(bad.status).toBe(404);
});

test("MCP requires a bearer token", async () => {
  const res = await app.handle(new Request("http://localhost:8811/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  }));
  expect(res.status).toBe(401);
});

test("full OAuth 2.1 flow: DCR → consent → PKCE token → tools", async () => {
  // 1. dynamic client registration
  const reg = await app.handle(new Request("http://localhost:8811/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test-agent", redirect_uris: ["http://localhost:9999/cb"] }),
  }));
  expect(reg.status).toBe(201);
  const client = await reg.json();

  // 2. authorize (with session cookie) → consent page → approve → code
  const verifier = "test-verifier-abc";
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://localhost:9999/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
  });
  const authz = await app.handle(new Request(`http://localhost:8811/authorize?${q}`, { headers: { cookie }, redirect: "manual" }));
  expect(authz.status).toBe(200);
  const html = await authz.text();
  const approveId = /\/authorize\/approve\?id=([\w-]+)/.exec(html)?.[1];
  expect(approveId).toBeTruthy();
  const approve = await app.handle(new Request(`http://localhost:8811/authorize/approve?id=${approveId}`, { headers: { cookie }, redirect: "manual" }));
  expect(approve.status).toBe(302);
  const code = new URL(approve.headers.get("location")!).searchParams.get("code");
  expect(code).toBeTruthy();

  // 3. token exchange with PKCE
  const tokenRes = await app.handle(new Request("http://localhost:8811/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      client_id: client.client_id,
      redirect_uri: "http://localhost:9999/cb",
      code_verifier: verifier,
    }).toString(),
  }));
  expect(tokenRes.status).toBe(200);
  const tokens = await tokenRes.json();
  expect(tokens.access_token).toBeTruthy();

  // wrong verifier must fail
  const badToken = await app.handle(new Request("http://localhost:8811/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      client_id: client.client_id,
      redirect_uri: "http://localhost:9999/cb",
      code_verifier: "wrong",
    }).toString(),
  }));
  expect(badToken.status).toBe(400);

  // 4. MCP over the OAuth token: initialize → tools/list → tools/call
  const h = { "content-type": "application/json", authorization: `Bearer ${tokens.access_token}` };
  const init = await app.handle(new Request("http://localhost:8811/mcp", { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }));
  const initBody = await init.json();
  expect(initBody.result.serverInfo.name).toBe("skill-sync");

  const list = await app.handle(new Request("http://localhost:8811/mcp", { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) }));
  const tools = (await list.json()).result.tools.map((t: any) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["list_skills", "get_skill", "search_skills", "propose_skill_change"]));

  const call = await app.handle(new Request("http://localhost:8811/mcp", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_skills", arguments: { query: "demo" } } }),
  }));
  const result = (await call.json()).result;
  expect(result.isError).toBeUndefined();
  const skills = JSON.parse(result.content[0].text).skills;
  expect(skills.some((s: any) => s.name === "demo")).toBe(true);

  const missing = await app.handle(new Request("http://localhost:8811/mcp", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_skill", arguments: { name: "nope" } } }),
  }));
  expect((await missing.json()).result.isError).toBe(true);
});

test("propose_skill_change validates input before touching GitHub", async () => {
  const { openSkillProposal } = await import("../src/lib/github");
  await expect(openSkillProposal({ skill_path: "evil.md", content: "x", summary: "s", who: "t" })).rejects.toThrow(/Invalid skill_path/);
  await expect(openSkillProposal({ skill_path: "skills/demo/SKILL.md", content: "  ", summary: "s", who: "t" })).rejects.toThrow(/empty/);
});
