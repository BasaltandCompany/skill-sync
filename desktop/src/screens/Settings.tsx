import { useEffect, useState } from "react";
import { getConfig, getMe, store, type ServerConfig, type User } from "../lib/api";

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<User | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [server, setServer] = useState(store.server);

  useEffect(() => {
    getMe().then(setMe).catch(() => {});
    getConfig().then(setConfig).catch(() => {});
  }, []);

  return (
    <div className="max-w-xl p-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="mt-6">
        <div className="text-xs tracking-wide text-basalt-400 uppercase">Signed in</div>
        <p className="mt-1 text-sm">
          {me?.name ?? "—"} <span className="text-basalt-400">{me?.email}</span>
          {me?.role && <span className="ml-2 rounded bg-basalt-800 px-2 py-0.5 text-xs">{me.role}</span>}
        </p>
      </section>

      <section className="mt-6">
        <div className="text-xs tracking-wide text-basalt-400 uppercase">Server</div>
        <div className="mt-1 flex gap-2">
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="flex-1 rounded-lg border border-basalt-700 bg-basalt-950 px-3 py-2 text-sm outline-none focus:border-basalt-accent"
          />
          <button
            onClick={() => {
              store.server = server;
              location.reload();
            }}
            className="rounded-lg bg-basalt-800 px-4 text-sm hover:bg-basalt-700"
          >
            Save
          </button>
        </div>
      </section>

      <section className="mt-6">
        <div className="text-xs tracking-wide text-basalt-400 uppercase">Server config</div>
        <ul className="mt-1 space-y-1 text-sm text-basalt-200">
          <li>Skills repo: {config?.repo ?? "not configured"}</li>
          <li>GitHub proposals: {config?.github_configured ? "ready" : "GITHUB_BOT_TOKEN missing"}</li>
          <li>Skill mirror: {config?.skills_configured ? "ready" : "SKILLS_REPO_URL missing"}</li>
        </ul>
      </section>

      <section className="mt-8">
        <button
          onClick={() => {
            store.token = null;
            onLogout();
          }}
          className="rounded-lg border border-basalt-700 px-4 py-2 text-sm text-basalt-200 hover:border-red-500 hover:text-red-400"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
