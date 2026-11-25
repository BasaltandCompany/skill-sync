import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as s from "./schema";

export const DB_PATH =
  process.env.DB_PATH ?? (process.env.NODE_ENV === "production" ? "/data/skill-sync.db" : "./.data/skill-sync.db");

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
    role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, gh_team_slug TEXT
  );
  CREATE TABLE IF NOT EXISTS team_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL, redirect_uris TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL, scope TEXT NOT NULL, user_id TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token TEXT PRIMARY KEY, refresh_token TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL, user_id TEXT NOT NULL, scope TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS oidc_states (
    state TEXT PRIMARY KEY, verifier TEXT NOT NULL, next TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
  );
`);

export const db = drizzle(sqlite, { schema: s });
export const schema = s;
// Direct re-exports of tables so consumers can `import { oidcStates } from "../db"`.
export const { users, sessions, teams, teamMembers, oauthClients, authCodes, oauthTokens, oidcStates, auditLog } = s;

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY;
export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;

// ── Users & sessions ──────────────────────────────────────────────────────

export function getUser(id: string) {
  return db.select().from(s.users).where(eq(s.users.id, id)).get();
}

export function getUserByEmail(email: string) {
  return db.select().from(s.users).where(eq(s.users.email, email)).get();
}

export function upsertUser(email: string, name?: string | null) {
  const existing = getUserByEmail(email);
  if (existing) {
    if (name && existing.name !== name) db.update(s.users).set({ name }).where(eq(s.users.id, existing.id)).run();
    return existing;
  }
  const user = { id: crypto.randomUUID(), email, name: name ?? null, role: "member" as const };
  db.insert(s.users).values(user).run();
  audit(user.email, "user.created");
  return user;
}

export function createSession(userId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.insert(s.sessions).values({ token, userId, expiresAt }).run();
  return token;
}

export function getSessionUser(token: string) {
  const row = db.select().from(s.sessions).where(eq(s.sessions.token, token)).get();
  if (!row || new Date(row.expiresAt + "Z").getTime() < Date.now()) return null;
  return getUser(row.userId) ?? null;
}

// ── OAuth 2.1 (MCP clients) ───────────────────────────────────────────────

export function createOAuthClient(clientName: string, redirectUris: string[]) {
  const clientId = crypto.randomUUID();
  db.insert(s.oauthClients).values({ clientId, clientName, redirectUris: JSON.stringify(redirectUris) }).run();
  return clientId;
}

export function getOAuthClient(clientId: string) {
  const row = db.select().from(s.oauthClients).where(eq(s.oauthClients.clientId, clientId)).get();
  if (!row) return null;
  return { ...row, redirect_uris: JSON.parse(row.redirectUris) as string[] };
}

export function createAuthCode(clientId: string, redirectUri: string, codeChallenge: string, scope: string, userId: string) {
  const code = crypto.randomUUID();
  db.insert(s.authCodes).values({ code, clientId, redirectUri, codeChallenge, scope, userId }).run();
  return code;
}

export function getAuthCode(code: string) {
  return db.select().from(s.authCodes).where(eq(s.authCodes.code, code)).get() ?? null;
}

export function consumeAuthCode(code: string) {
  db.update(s.authCodes).set({ used: 1 }).where(eq(s.authCodes.code, code)).run();
}

export function issueTokens(clientId: string, scope: string, userId: string) {
  const accessToken = "ssa_" + crypto.randomUUID().replaceAll("-", "");
  const refreshToken = "ssr_" + crypto.randomUUID().replaceAll("-", "");
  db.insert(s.oauthTokens).values({ accessToken, refreshToken, clientId, userId, scope }).run();
  return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 0, scope };
}

export function rotateRefreshToken(refreshToken: string, clientId: string) {
  const row = db.select().from(s.oauthTokens).where(eq(s.oauthTokens.refreshToken, refreshToken)).get();
  if (!row || row.clientId !== clientId) return null;
  db.delete(s.oauthTokens).where(eq(s.oauthTokens.refreshToken, refreshToken)).run();
  return issueTokens(row.clientId, row.scope, row.userId);
}

// Resolve any bearer token to a user: desktop session or MCP OAuth access token.
export function userForBearer(token: string) {
  return (
    getSessionUser(token) ??
    (() => {
      const t = db.select().from(s.oauthTokens).where(eq(s.oauthTokens.accessToken, token)).get();
      return t ? getUser(t.userId) : null;
    })()
  );
}

export function audit(actor: string, action: string, detail?: unknown) {
  db.insert(s.auditLog)
    .values({ actor, action, detail: detail === undefined ? null : JSON.stringify(detail) })
    .run();
}

// ── tiny helper to avoid importing eq in every consumer ───────────────────
import { eq } from "drizzle-orm";
