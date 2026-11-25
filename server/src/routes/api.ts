import { Hono } from "hono";
import { audit, userForBearer } from "../db";
import { getSkill, listSkills, searchSkills } from "../lib/skills";
import { GITHUB_REPO, listOpenPRs, submitReview } from "../lib/github";
import { sessionUser } from "./oauth";

type User = { id: string; email: string; name: string | null; role: string };

// Desktop-app API. Bearer (session token) or cookie auth; every mutating call
// is attributed and audited.

export const apiRoutes = () =>
  new Hono<{ Variables: { user: User } }>().use("/api/*", async (c, next) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)/i)?.[1] ?? "";
    const user = bearer ? userForBearer(bearer) : sessionUser(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", user);
    await next();
  })
    .get("/api/me", (c) => {
      const u = c.get("user");
      return c.json({ id: u.id, email: u.email, name: u.name, role: u.role });
    })
    .get("/api/config", (c) =>
      c.json({
        repo: GITHUB_REPO || null,
        github_configured: !!process.env.GITHUB_BOT_TOKEN,
        skills_configured: !!process.env.SKILLS_REPO_URL,
      })
    )
    .get("/api/skills", async (c) => {
      const q = c.req.query("q");
      return c.json({ skills: q ? await searchSkills(q) : await listSkills() });
    })
    .get("/api/skills/:name", async (c) => {
      const file = await getSkill(c.req.param("name"), c.req.query("path"));
      return file ? c.json(file) : c.json({ error: "not found" }, 404);
    })
    .get("/api/pulls", async (c) => {
      try {
        return c.json({ pulls: await listOpenPRs() });
      } catch (e: any) {
        return c.json({ error: String(e?.message ?? e) }, 502);
      }
    })
    .post("/api/pulls/:number/reviews", async (c) => {
      const user = c.get("user");
      const body = await c.req.json<{ event?: string; body?: string }>().catch(() => ({}) as any);
      try {
        await submitReview(Number(c.req.param("number")), body.event as any, body.body ?? "", user.email);
        audit(user.email, "skill.review", { pr: Number(c.req.param("number")), event: body.event });
        return c.json({ ok: true });
      } catch (e: any) {
        return c.json({ error: String(e?.message ?? e) }, 502);
      }
    });
