import { Elysia } from "elysia";
import {
  OAUTH_CODE_TTL_MS,
  consumeAuthCode,
  createAuthCode,
  createOAuthClient,
  getAuthCode,
  getSessionUser,
  getOAuthClient,
  issueTokens,
  rotateRefreshToken,
} from "../db";

// OAuth 2.1 authorization server so MCP clients (pi, Claude, Cursor, …)
// connect the standard way: 401 → discovery → dynamic client registration →
// browser consent (PKCE S256) → bearer token, auto-refreshed by the client.
// Ported from feedback-server's proven layer; one addition: consent requires
// a signed-in human (session cookie), so every MCP token is attributed to a
// real org user.

const SCOPE = "skills";
const origin = (request: Request) => new URL(request.url).origin;

const pending = new Map<
  string,
  { client_id: string; redirect_uri: string; code_challenge: string; state: string; scope: string; user_id: string }
>();

const metadata = (request: Request) => {
  const o = origin(request);
  return {
    issuer: o,
    registration_endpoint: `${o}/register`,
    authorization_endpoint: `${o}/authorize`,
    token_endpoint: `${o}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
};

export const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0A0A0A;color:#FAFAFA}
main{max-width:26rem;padding:2rem;background:#111113;border-radius:0}h1{font-size:1.1rem}code{background:#1A1A1C;padding:.1rem .3rem}
a.btn{display:inline-block;margin:.5rem .5rem 0 0;padding:.5rem 1.2rem;text-decoration:none;color:#fff}
.allow{background:#FAFAFA;color:#0A0A0A}.deny{background:#1A1A1C}</style></head>
<body><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );

function sessionFromCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)skill_sync_session=([^;]+)/.exec(cookie);
  return m ? getSessionUser(decodeURIComponent(m[1])) : null;
}

function redirect(to: string, headers?: Record<string, string>) {
  return new Response(null, { status: 302, headers: { location: to, ...headers } });
}

export const oauthRoutes = () =>
  new Elysia({ name: "oauth" })
    // RFC 9728 protected-resource metadata. Root + path-aware variant.
    .get("/.well-known/oauth-protected-resource", ({ request }) => {
      const o = origin(request);
      return { resource: `${o}/mcp`, authorization_servers: [o], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] };
    })
    .get("/.well-known/oauth-protected-resource/mcp", ({ request }) => {
      const o = origin(request);
      return { resource: `${o}/mcp`, authorization_servers: [o], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] };
    })
    // RFC 8414 authorization-server metadata.
    .get("/.well-known/oauth-authorization-server", ({ request }) => metadata(request))

    // Dynamic client registration (RFC 7591). Public PKCE clients only.
    .post("/register", async ({ request, set }) => {
      let body: { client_name?: string; redirect_uris?: string[] } = {};
      try {
        body = await request.json();
      } catch {}
      const uris = (body.redirect_uris ?? []).filter((u) => /^https?:\/\//.test(u));
      if (uris.length === 0) {
        set.status = 400;
        return { error: "invalid_client_metadata", error_description: "redirect_uris required" };
      }
      const client_id = createOAuthClient(body.client_name ?? "MCP client", uris);
      const o = origin(request);
      set.status = 201;
      return {
        client_id,
        client_name: body.client_name ?? "MCP client",
        redirect_uris: uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint: `${o}/oauth/token`,
      };
    })

    // Authorization endpoint: validate, require a session, show consent page.
    .get("/authorize", ({ request, query }) => {
      const o = origin(request);
      const client = query.client_id ? getOAuthClient(query.client_id) : null;
      if (!client) return page("skill-sync", "<h1>Unknown client</h1><p><code>client_id</code> not registered.</p>");
      if (!query.redirect_uri || !client.redirect_uris.includes(query.redirect_uri))
        return page("skill-sync", "<h1>Invalid redirect</h1><p><code>redirect_uri</code> not registered for this client.</p>");
      if (query.response_type !== "code")
        return page("skill-sync", "<h1>Unsupported</h1><p>Only <code>response_type=code</code> is supported.</p>");
      if (query.code_challenge_method !== "S256" || !query.code_challenge)
        return page("skill-sync", "<h1>PKCE required</h1><p><code>code_challenge_method=S256</code> is required.</p>");

      const user = sessionFromCookie(request);
      if (!user) {
        // Consent requires a signed-in human — that's what attributes the token.
        return redirect(`${o}/auth/login?next=${encodeURIComponent(request.url)}`);
      }

      const id = crypto.randomUUID();
      pending.set(id, {
        client_id: query.client_id!,
        redirect_uri: query.redirect_uri,
        code_challenge: query.code_challenge,
        state: query.state ?? "",
        scope: SCOPE,
        user_id: user.id,
      });
      if (pending.size > 100) {
        const first = pending.keys().next().value;
        if (first) pending.delete(first);
      }
      return page(
        "Allow access? · skill-sync",
        `<h1>Allow access?</h1><p><strong>${client.clientName}</strong> wants to connect to skill-sync as <strong>${user.email}</strong> — browse skills and propose changes on your behalf.</p>
<p><a class="btn allow" href="${o}/authorize/approve?id=${id}">Allow</a><a class="btn deny" href="${o}/authorize/deny?id=${id}">Deny</a></p>`
      );
    })

    .get("/authorize/approve", ({ query }) => {
      const req = query.id ? pending.get(query.id) : undefined;
      if (!req) return page("skill-sync", "<h1>Expired</h1><p>This approval request is no longer valid — start the connection again.</p>");
      pending.delete(query.id!);
      const code = createAuthCode(req.client_id, req.redirect_uri, req.code_challenge, req.scope, req.user_id);
      const sep = req.redirect_uri.includes("?") ? "&" : "?";
      return redirect(`${req.redirect_uri}${sep}code=${code}${req.state ? `&state=${encodeURIComponent(req.state)}` : ""}`);
    })

    .get("/authorize/deny", ({ query }) => {
      const req = query.id ? pending.get(query.id) : undefined;
      if (req) {
        pending.delete(query.id!);
        const sep = req.redirect_uri.includes("?") ? "&" : "?";
        return redirect(`${req.redirect_uri}${sep}error=access_denied${req.state ? `&state=${encodeURIComponent(req.state)}` : ""}`);
      }
      return page("skill-sync", "<h1>Expired</h1><p>This request is no longer valid.</p>");
    })

    // Token endpoint. PKCE S256: code_verifier must hash to the challenge.
    .post("/oauth/token", async ({ request, set }) => {
      const form: Record<string, string> = {};
      try {
        for (const [k, v] of (await request.formData()).entries()) form[k] = String(v);
      } catch {}

      if (form.grant_type === "refresh_token") {
        if (!form.refresh_token || !form.client_id) {
          set.status = 400;
          return { error: "invalid_request" };
        }
        const fresh = await rotateRefreshToken(form.refresh_token, form.client_id);
        if (!fresh) {
          set.status = 400;
          return { error: "invalid_grant", error_description: "refresh token unknown, revoked, or expired" };
        }
        return fresh;
      }
      if (form.grant_type !== "authorization_code") {
        set.status = 400;
        return { error: "unsupported_grant_type" };
      }

      const fail = (description: string) => {
        set.status = 400;
        return { error: "invalid_grant", error_description: description };
      };
      const row = form.code ? getAuthCode(form.code) : null;
      if (!row) return fail("unknown code");
      if (row.used === 1) return fail("code already used");
      if (Date.now() - new Date(row.createdAt.replace(" ", "T") + "Z").getTime() > OAUTH_CODE_TTL_MS) return fail("code expired");
      if (!form.client_id || form.client_id !== row.clientId) return fail("client mismatch");
      if (!form.redirect_uri || form.redirect_uri !== row.redirectUri) return fail("redirect_uri mismatch");
      if (!form.code_verifier) return fail("code_verifier required");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.code_verifier));
      if (Buffer.from(digest).toString("base64url") !== row.codeChallenge) return fail("PKCE verification failed");

      consumeAuthCode(form.code);
      return issueTokens(row.clientId, row.scope, row.userId);
    });

export { SCOPE, sessionFromCookie, redirect };
