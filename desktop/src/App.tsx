import { createSignal, onSettled, Show } from "solid-js";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@basaltac/ui";
import { getMe, loginUrl, store } from "./lib/api";
import Library from "./screens/Library";
import Review from "./screens/Review";
import Settings from "./screens/Settings";
import Sync from "./screens/Sync";

type Screen = "library" | "sync" | "review" | "settings";

const TABS: [Screen, string][] = [
  ["library", "Skills"],
  ["sync", "Sync"],
  ["review", "Review"],
  ["settings", "Settings"],
];

export default function App() {
  const [authed, setAuthed] = createSignal<null | boolean>(null); // null = checking
  const [screen, setScreen] = createSignal<Screen>("library");

  async function check() {
    if (!store.token) {
      setAuthed(false);
      return;
    }
    try {
      await getMe();
      setAuthed(true);
    } catch {
      setAuthed(false);
    }
  }

  onSettled(() => {
    check();
    // Deep link: skill-sync://oauth/callback#token=...
    let unsub: (() => void) | undefined;
    onOpenUrl((urls) => {
      for (const u of urls) {
        const token = new URL(u).hash.match(/token=([^&]+)/)?.[1];
        if (token) {
          store.token = decodeURIComponent(token);
          setAuthed(null);
          check();
        }
      }
    }).then((u) => (unsub = u));
    return () => unsub?.();
  });

  return (
    <Show when={authed() !== null} fallback={<Login />}>
      <Show when={authed()} fallback={<Login />}>
        <div class="flex h-full">
          <nav class="flex w-48 flex-col gap-1 border-r border-border bg-card p-3">
            <div class="mb-4 px-2 font-heading text-lg tracking-tight">skill-sync</div>
            {TABS.map(([id, label]) => (
              <button
                type="button"
                onClick={() => setScreen(id)}
                class={`rounded-none px-3 py-2 text-left text-sm transition-colors ${
                  screen() === id
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <main class="flex-1 overflow-auto">
            <Show when={screen() === "library"}>
              <Library />
            </Show>
            <Show when={screen() === "sync"}>
              <Sync />
            </Show>
            <Show when={screen() === "review"}>
              <Review />
            </Show>
            <Show when={screen() === "settings"}>
              <Settings onLogout={() => setAuthed(false)} />
            </Show>
          </main>
        </div>
      </Show>
    </Show>
  );
}

function Login() {
  const [server, setServer] = createSignal(store.server);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function signIn() {
    setBusy(true);
    setError("");
    store.server = server();
    // Browser completes the OIDC dance; the token lands via deep link.
    try {
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
    <div class="grid h-full place-items-center">
      <Card class="w-96">
        <CardHeader>
          <CardTitle class="font-heading text-xl">skill-sync</CardTitle>
          <CardDescription>Your org's skills, everywhere.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-1.5">
            <Label for="server">Server</Label>
            <Input
              id="server"
              value={server()}
              onInput={(e) => setServer(e.currentTarget.value)}
              placeholder="https://skills.company.com"
            />
          </div>
          <Button class="w-full" disabled={busy() || !server().trim()} onClick={signIn}>
            {busy() ? "Opening browser…" : "Sign in with your account"}
          </Button>
          <p class="text-xs text-muted-foreground">
            Your browser opens once; skill-sync catches the sign-in automatically. Did it slip past? Paste your token:
          </p>
          <Input
            placeholder="paste session token"
            onKeyDown={(e) => e.key === "Enter" && pasteToken(e.currentTarget.value)}
          />
          <Show when={error()}>
            <p class="text-xs text-destructive">{error()}</p>
          </Show>
          <p class="text-xs text-muted-foreground">
            First run here? Start the server: <code>cd server &amp;&amp; bun run dev</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

