import { Elysia } from "elysia";
import { audit, userForBearer } from "../db";
import { getSkill, listSkills, searchSkills } from "../lib/skills";
import { listOpenPRs, submitReview } from "../lib/github";
import { sessionFromCookie } from "./oauth";

type User = { id: string; email: string; name: string | null; role: string };

// Desktop-app API. Bearer (session token) or cookie auth; every mutating call
// is attributed and audited.

export const apiRoutes = () =>
  new Elysia({ name: "api" })
    .derive(async ({ request }) => {
      const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)/i)?.[1] ?? "";
      const user: User | null = bearer ? userForBearer(bearer) : sessionFromCookie(request);
      return { user };
    })
    .onBeforeHandle(({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthenticated" };
      }
    })
    .get("/api/me", ({ user }) => ({ id: user!.id, email: user!.email, name: user!.name, role: user!.role }))
    .get("/api/config", () => ({
      repo: process.env.SKILLS_REPO_GITHUB ?? null,
      github_configured: !!process.env.GITHUB_BOT_TOKEN,
      skills_configured: !!process.env.SKILLS_REPO_URL,
    }))
    .get("/api/skills", async ({ query }) => ({
      skills: query.q ? await searchSkills(query.q) : await listSkills(),
    }))
    .get("/api/skills/:name", async ({ params, query, set }) => {
      const file = await getSkill(params.name, query.path);
      if (!file) {
        set.status = 404;
        return { error: "not found" };
      }
      return file;
    })
    .get("/api/pulls", async ({ set }) => {
      try {
        return { pulls: await listOpenPRs() };
      } catch (e: any) {
        set.status = 502;
        return { error: String(e?.message ?? e) };
      }
    })
    .post("/api/pulls/:number/reviews", async ({ params, body, user, set }) => {
      const b = (body ?? {}) as { event?: string; body?: string };
      try {
        await submitReview(Number(params.number), b.event as any, b.body ?? "", user!.email);
        audit(user!.email, "skill.review", { pr: Number(params.number), event: b.event });
        return { ok: true };
      } catch (e: any) {
        set.status = 502;
        return { error: String(e?.message ?? e) };
      }
    });
