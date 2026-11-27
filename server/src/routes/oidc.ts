import { Elysia } from "elysia";
import { createSession, getSessionUser, oidcStates, upsertUser, db, audit } from "../db";
import { eq } from "drizzle-orm";
import { page, redirect } from "./oauth";

// Sign-in with the org account. OIDC when OIDC_ISSUER is configured (Google by
// default); a dev email fallback when ALLOW_DEV_LOGIN=1 so local runs and
// tests work without an IdP. The session cookie doubles as MCP consent auth,
// which is what ties every MCP token to a real org user.

const OIDC_ISSUER = process.env.OIDC_ISSUER ?? "";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "";
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "";
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";

const sha256 = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
const b64url = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64url");

function sessionCookie(token: string) {
  return `skill_sync_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
}

function userFromCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)skill_sync_session=([^;]+)/.exec(cookie);
  return m ? getSessionUser(decodeURIComponent(m[1])) : null;
}

// The session token is a credential — `next` decides where it lands, so an
// arbitrary URL would leak it (open redirect → token theft). Allowed:
// skill-sync:// deep links, the server's own origin, and (dev only) localhost.
function withToken(next: string, token: string, request: Request): Response {
  if (next.startsWith("skill-sync://")) return redirect(`${next}#token=${token}`);
  let url: URL;
  try {
    url = new URL(next, new URL(request.url).origin);
  } catch {
    return page("skill-sync", "<h1>Sign-in failed</h1><p>Invalid redirect target.</p>");
  }
  if (url.origin !== new URL(request.url).origin) {
    const devLocal = ALLOW_DEV_LOGIN && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(url.origin);
    const allowlisted = (process.env.ALLOWED_LOGIN_ORIGINS ?? "").split(",").includes(url.origin);
    if (!devLocal && !allowlisted)
      return page("skill-sync", `<h1>Blocked</h1><p>Redirect origin not allowed: ${url.origin}. Add it to ALLOWED_LOGIN_ORIGINS.</p>`);
  }
  return redirect(`${url}#token=${token}`);
}

async function discovery(issuer: string) {
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
  return res.json() as Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }>;
}

export const authRoutes = () =>
  new Elysia({ name: "auth" })
    .get("/auth/me", ({ request, set }) => {
      const user = userFromCookie(request);
      if (!user) {
        set.status = 401;
        return { error: "unauthenticated" };
      }
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    })
    .post("/auth/logout", ({ set }) => {
      set.headers["set-cookie"] = "skill_sync_session=; Path=/; Max-Age=0";
      set.status = 204;
      return null;
    })

    .get("/auth/login", async ({ request, query }) => {
      const next = query.next ?? "/";
      if (!OIDC_ISSUER) {
        if (!ALLOW_DEV_LOGIN)
          return page(
            "skill-sync",
            "<h1>SSO not configured</h1><p>Set <code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code>, <code>OIDC_CLIENT_SECRET</code> (any OIDC provider; Google works). For local dev set <code>ALLOW_DEV_LOGIN=1</code>.</p>"
          );
        return page(
          "skill-sync · dev login",
          `<h1>Dev login</h1><form method="post" action="/auth/dev-login"><input name="next" type="hidden" value="${next}">
<input name="email" placeholder="you@company.com" required><button>Sign in</button></form>`
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
      url.searchParams.set("redirect_uri", `${origin(request)}/auth/callback`);
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return redirect(url.toString());
    })

    .post("/auth/dev-login", async ({ request, set }) => {
      if (!ALLOW_DEV_LOGIN) {
        set.status = 404;
        return null;
      }
      const form: Record<string, string> = {};
      try {
        for (const [k, v] of (await request.formData()).entries()) form[k] = String(v);
      } catch {}
      const email = (form.email ?? "").trim();
      const next = form.next ?? "/";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return page("skill-sync", "<h1>Invalid email</h1>");
      const user = upsertUser(email, email.split("@")[0]);
      const token = createSession(user.id);
      audit(user.email, "session.dev_login");
      set.headers["set-cookie"] = sessionCookie(token);
      return withToken(next, token, request);
    })

    .get("/auth/callback", async ({ request, query, set }) => {
      const d = await discovery(OIDC_ISSUER);
      const code = query.code;
      const state = query.state ?? "";
      const row = db.select().from(oidcStates).where(eq(oidcStates.state, state)).get();
      if (!code || !row) return page("skill-sync", "<h1>Sign-in failed</h1><p>Unknown or expired state — try again.</p>");
      db.delete(oidcStates).where(eq(oidcStates.state, state)).run();

      const tokenRes = await fetch(d.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${origin(request)}/auth/callback`,
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
      set.headers["set-cookie"] = sessionCookie(token);
      return withToken(row.next || "/", token, request);
    });

function origin(request: Request) {
  return new URL(request.url).origin;
}
