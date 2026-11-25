// skill-sync server API client. The session token arrives via the
// skill-sync:// deep link (fragment) and is kept in localStorage.

export type User = { id: string; email: string; name: string | null; role: string };
export type Skill = { name: string; description: string; files: string[] };
export type Pull = { number: number; title: string; author: string; html_url: string; created_at: string; draft: boolean };
export type ServerConfig = { repo: string | null; github_configured: boolean; skills_configured: boolean };

const TOKEN_KEY = "skill_sync_token";
const SERVER_KEY = "skill_sync_server";

export const store = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set token(v: string | null) {
    v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY);
  },
  get server(): string {
    return localStorage.getItem(SERVER_KEY) ?? "http://localhost:8811";
  },
  set server(v: string) {
    localStorage.setItem(SERVER_KEY, v.replace(/\/$/, ""));
  },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${store.server}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${store.token ?? ""}`, ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    store.token = null;
    throw new Error("unauthenticated");
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getMe = () => api<User>("/auth/me");
export const getConfig = () => api<ServerConfig>("/api/config");
export const listSkills = () => api<{ skills: Skill[] }>("/api/skills");
export const searchSkills = (q: string) => api<{ skills: Skill[] }>(`/api/skills?q=${encodeURIComponent(q)}`);
export const getSkillFile = (name: string, path?: string) =>
  api<{ path: string; content: string }>(`/api/skills/${encodeURIComponent(name)}${path ? `?path=${encodeURIComponent(path)}` : ""}`);
export const listPulls = () => api<{ pulls: Pull[] }>("/api/pulls");
export const reviewPull = (number: number, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body?: string) =>
  api<{ ok: boolean }>(`/api/pulls/${number}/reviews`, { method: "POST", body: JSON.stringify({ event, body }) });

export function loginUrl() {
  return `${store.server}/auth/login?next=${encodeURIComponent("skill-sync://oauth/callback")}`;
}
