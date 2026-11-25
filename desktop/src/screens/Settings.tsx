import { createSignal, Show } from "solid-js";
import { getConfig, getMe, store, type ServerConfig, type User } from "../lib/api";
import { Button, Input, Separator } from "@basaltac/ui";

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = createSignal<User | null>(null);
  const [config, setConfig] = createSignal<ServerConfig | null>(null);
  const [server, setServer] = createSignal(store.server);

  getMe().then(setMe).catch(() => {});
  getConfig().then(setConfig).catch(() => {});

  return (
    <div class="max-w-xl p-8">
      <h1 class="font-heading text-lg">Settings</h1>

      <section class="mt-6">
        <div class="text-xs uppercase tracking-wide text-muted-foreground">Signed in</div>
        <p class="mt-1 text-sm">
          {me()?.name ?? "—"} <span class="text-muted-foreground">{me()?.email}</span>
          <Show when={me()?.role}>
            <span class="ml-2 border border-border px-2 py-0.5 text-xs">{me()!.role}</span>
          </Show>
        </p>
      </section>

      <Separator class="my-6" />

      <section>
        <div class="text-xs uppercase tracking-wide text-muted-foreground">Server</div>
        <div class="mt-1 flex gap-2">
          <Input value={server()} onInput={(e) => setServer(e.currentTarget.value)} />
          <Button
            variant="secondary"
            onClick={() => {
              store.server = server();
              location.reload();
            }}
          >
            Save
          </Button>
        </div>
      </section>

      <section class="mt-6">
        <div class="text-xs uppercase tracking-wide text-muted-foreground">Server config</div>
        <ul class="mt-1 space-y-1 text-sm">
          <li>Skills repo: {config()?.repo ?? "not configured"}</li>
          <li>GitHub proposals: {config()?.github_configured ? "ready" : "server token missing"}</li>
          <li>Skill mirror: {config()?.skills_configured ? "ready" : "SKILLS_REPO_URL missing"}</li>
        </ul>
      </section>

      <Separator class="my-6" />

      <Button
        variant="destructive"
        onClick={() => {
          store.token = null;
          onLogout();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
