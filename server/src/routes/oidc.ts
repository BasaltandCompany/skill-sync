import { Hono } from "hono";
import { createSession, getSessionUser, oidcStates, upsertUser, db, audit } from "../db";
import { page } from "./oauth";

// Sign-in with the org account. OIDC when OIDC_ISSUER is configured (Google by
// default); a dev email fallback when ALLOW_DEV_LOGIN=1 so local runs and
// tests work without an IdP. The session cookie doubles as MCP consent auth,
// which is what ties every MCP token to a real org user.

const OIDC_ISSUER = process.env.OIDC_ISSUER ?? "";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "";
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "";
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";

const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64url");
const sha256 = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

function sessionCookie(token: string) {
  return `skill_sync_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
}

function userFromCookie(c: { req: { header: (n: string) => string | undefined } }) {
  const cookie = c.req.header("cookie") ?? "";
  const m = /(?:^|;\s*)skill_sync_session=([^;]+)/.exec(cookie);
  return m ? getSessionUser(decodeURIComponent(m[1])) : null;
}

async function discovery(issuer: string) {
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
  return res.json() as Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }>;
}

export const authRoutes = () =>
  new Hono()
    .get("/auth/me", (c) => {
      const user = userFromCookie(c);
      return user ? c.json({ id: user.id, email: user.email, name: user.name, role: user.role }) : c.json({ error: "unauthenticated" }, 401);
    })
    .post("/auth/logout", (c) => c.header("set-cookie", "skill_sync_session=; Path=/; Max-Age=0").body(null, 204))

    .get("/auth/login", async (c) => {
      const next = c.req.query("next") ?? "/";
      if (!OIDC_ISSUER) {
        if (!ALLOW_DEV_LOGIN)
          return page(
            "skill-sync",
            "<h1>SSO not configured</h1><p>Set <code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code>, <code>OIDC_CLIENT_SECRET</code> (any OIDC provider; Google works). For local dev set <code>ALLOW_DEV_LOGIN=1</code>.</p>"
          );
        return page(
          "skill-sync · dev login",
          `<h1>Dev login</h1><form method="post" action="/auth/dev-login"><input name="next" type="hidden" value="${next}">
<input name="email" placeholder="you@company.com" required style="padding:.4rem;border-radius:6px"><button style="padding:.4rem .8rem;margin-left:.4rem">Sign in</button></form>`
        );
      }
      const d = await discovery(OIDC_ISSUER);
      const state = crypto.randomUUID();
      const verifier = crypto.randomUUID() + crypto.randomUUID();
      const challenge = b64url(await sha256(verifier));
      db.insert(oidcStates).values({ state, verifier, next }).run();
      const url = new URL(d.authorization_endpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", OIDC_CLIENT_ID);
      url.searchParams.set("redirect_uri", `${origin(c.req.raw)}/auth/callback`);
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return c.redirect(url.toString());
    })

    .post("/auth/dev-login", async (c) => {
      if (!ALLOW_DEV_LOGIN) return c.body(null, 404);
      const form = await c.req.parseBody();
      const email = String(form.email ?? "").trim();
      const next = String(form.next ?? "/");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return page("skill-sync", "<h1>Invalid email</h1>");
      const user = upsertUser(email, email.split("@")[0]);
      const token = createSession(user.id);
      audit(user.email, "session.dev_login");
      c.header("set-cookie", sessionCookie(token));
      return c.redirect(withToken(next, token));
    })

    .get("/auth/callback", async (c) => {
      const d = await discovery(OIDC_ISSUER);
      const code = c.req.query("code");
      const state = c.req.query("state") ?? "";
      const row = db.select().from(oidcStates).where(eq(oidcStates.state, state)).get();
      if (!code || !row) return page("skill-sync", "<h1>Sign-in failed</h1><p>Unknown or expired state — try again.</p>");
      db.delete(oidcStates).where(eq(oidcStates.state, state)).run();

      const tokenRes = await fetch(d.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${origin(c.req.raw)}/auth/callback`,
          client_id: OIDC_CLIENT_ID,
          client_secret: OIDC_CLIENT_SECRET,
          code_verifier: row.verifier,
        }),
      });
      if (!tokenRes.ok) return page("skill-sync", `<h1>Sign-in failed</h1><pre>token exchange: ${await tokenRes.text()}</pre>`);
      const tokens = (await tokenRes.json()) as { id_token?: string };
      if (!tokens.id_token) return page("skill-sync", "<h1>Sign-in failed</h1><p>No id_token from provider.</p>");

      const { createRemoteJWKSet, jwtVerify } = await import("jose");
      const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), {
        issuer: d.issuer,
        audience: OIDC_CLIENT_ID,
      });
      const email = typeof payload.email === "string" ? payload.email : null;
      if (!email || payload.email_verified === false) return page("skill-sync", "<h1>Sign-in failed</h1><p>No verified email from provider.</p>");

      const user = upsertUser(email, (payload.name as string) ?? null);
      const token = createSession(user.id);
      audit(user.email, "session.oidc_login");
      c.header("set-cookie", sessionCookie(token));
      return c.redirect(withToken(row.next || "/", token));
    });

function origin(request: Request) {
  return new URL(request.url).origin;
}

// Desktop logins come back via a deep link — hand the session token over in
// the fragment (never sent to any server). Cookie is still set for consent flows.
function withToken(next: string, token: string) {
  if (next.startsWith("skill-sync://")) return `${next}#token=${token}`;
  return next;
}
import { eq } from "drizzle-orm";
