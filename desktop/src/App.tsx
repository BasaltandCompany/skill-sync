import { useEffect, useState } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getMe, loginUrl, store } from "./lib/api";
import Library from "./screens/Library";
import Review from "./screens/Review";
import Settings from "./screens/Settings";
import Sync from "./screens/Sync";

type Screen = "library" | "sync" | "review" | "settings";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [screen, setScreen] = useState<Screen>("library");

  // Deep link: skill-sync://oauth/callback#token=...
  useEffect(() => {
    let unsub: (() => void) | undefined;
    onOpenUrl((urls) => {
      for (const u of urls) {
        const hash = new URL(u).hash.match(/token=([^&]+)/)?.[1];
        if (hash) {
          store.token = decodeURIComponent(hash);
          setAuthed(null);
          check().catch(() => setAuthed(false));
        }
      }
    }).then((u) => (unsub = u));
    return () => unsub?.();
  }, []);

  async function check() {
    if (!store.token) {
      setAuthed(false);
      return;
    }
    await getMe();
    setAuthed(true);
  }

  useEffect(() => {
    check().catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="grid h-full place-items-center text-basalt-400">Connecting…</div>
    );
  }

  if (!authed) {
    return <Login />;
  }

  const tabs: [Screen, string][] = [
    ["library", "Skills"],
    ["sync", "Sync"],
    ["review", "Review"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex h-full">
      <nav className="flex w-44 flex-col gap-1 border-r border-basalt-800 bg-basalt-900 p-3">
        <div className="mb-4 px-2 text-sm font-semibold tracking-tight text-basalt-50">skill-sync</div>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScreen(id)}
            className={`rounded-lg px-3 py-2 text-left text-sm ${
              screen === id ? "bg-basalt-800 text-basalt-50" : "text-basalt-400 hover:bg-basalt-900 hover:text-basalt-200"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        {screen === "library" && <Library />}
        {screen === "sync" && <Sync />}
        {screen === "review" && <Review />}
        {screen === "settings" && <Settings onLogout={() => setAuthed(false)} />}
      </main>
    </div>
  );
}

function Login() {
  const [server, setServer] = useState(store.server);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setBusy(true);
    setError("");
    store.server = server;
    // Browser completes the OIDC dance; the token lands via deep link.
    try {
      const res = await fetch(`${store.server}/`, { method: "HEAD" });
      if (!res.ok && res.status !== 404) throw new Error(`Server unreachable (${res.status})`);
      await openUrl(loginUrl());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function pasteToken(token: string) {
    store.token = token.trim() || null;
    if (!token.trim()) return;
    try {
      await getMe();
    } catch {
      store.token = null;
      setError("That token didn't work.");
    }
  }

  return (
    <div className="grid h-full place-items-center">
      <div className="w-96 rounded-2xl border border-basalt-800 bg-basalt-900 p-8">
        <h1 className="text-lg font-semibold">skill-sync</h1>
        <p className="mt-1 text-sm text-basalt-400">Your org's skills, everywhere.</p>
        <label className="mt-6 block text-xs text-basalt-400">Server</label>
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="https://skills.company.com"
          className="mt-1 w-full rounded-lg border border-basalt-700 bg-basalt-950 px-3 py-2 text-sm outline-none focus:border-basalt-accent"
        />
        <button
          onClick={signIn}
          disabled={busy || !server.trim()}
          className="mt-4 w-full rounded-lg bg-basalt-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Opening browser…" : "Sign in with your account"}
        </button>
        <p className="mt-4 text-xs text-basalt-400">
          Your browser opens once; skill-sync catches the sign-in automatically. Did it slip past? Paste your token:
        </p>
        <input
          placeholder="paste session token"
          onKeyDown={(e) => e.key === "Enter" && pasteToken((e.target as HTMLInputElement).value)}
          className="mt-2 w-full rounded-lg border border-basalt-700 bg-basalt-950 px-3 py-2 text-sm outline-none focus:border-basalt-accent"
        />
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <p className="mt-6 text-xs text-basalt-400">
          First run here? Start the server: <code className="text-basalt-200">bun run dev</code> in server/
        </p>
      </div>
    </div>
  );
}
