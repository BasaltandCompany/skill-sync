import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Skill content lives in git. This DB only holds identity, auth, teams, audit.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // admin | lead | member — leads own a team's skills (approved via CODEOWNERS today)
  role: text("role").notNull().default("member"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  // GitHub team slug this team maps to in CODEOWNERS, e.g. "org/marketing-leads"
  ghTeamSlug: text("gh_team_slug"),
});

export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull(),
  userId: text("user_id").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  expiresAt: text("expires_at").notNull(),
});

// ── OAuth 2.1 authorization server (agents connect via MCP) ──────────────

export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").notNull(), // JSON array
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const authCodes = sqliteTable("auth_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  userId: text("user_id").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  accessToken: text("access_token").primaryKey(),
  refreshToken: text("refresh_token").notNull().unique(),
  clientId: text("client_id").notNull(),
  userId: text("user_id").notNull(),
  scope: text("scope").notNull(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// OIDC state (login → IdP → callback). In-memory would break across restarts
// mid-login; 30 rows of DB is cheaper than a second store.
export const oidcStates = sqliteTable("oidc_states", {
  state: text("state").primaryKey(),
  verifier: text("verifier").notNull(),
  next: text("next"), // where to redirect after login (desktop deep link)
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail"), // JSON
});
