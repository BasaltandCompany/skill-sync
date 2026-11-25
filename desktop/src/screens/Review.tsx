import { useEffect, useState } from "react";
import { listPulls, reviewPull, type Pull } from "../lib/api";

export default function Review() {
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [error, setError] = useState("");
  const [comment, setComment] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const r = await listPulls();
      setPulls(r.pulls);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function review(pull: Pull, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
    setBusy(true);
    try {
      await reviewPull(pull.number, event, comment[pull.number]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Review</h1>
      <p className="mt-1 text-sm text-basalt-400">
        Open skill-change PRs. Approval routing runs through CODEOWNERS on the repo — this is the same review, in-app.
      </p>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      <div className="mt-6 space-y-3">
        {pulls.length === 0 && !error && <p className="text-sm text-basalt-400">Nothing open.</p>}
        {pulls.map((pull) => (
          <div key={pull.number} className="rounded-xl border border-basalt-800 bg-basalt-900 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <a href={pull.html_url} className="text-sm font-medium hover:text-basalt-accent">
                #{pull.number} {pull.title}
              </a>
              <span className="text-xs text-basalt-400">
                {pull.author} · {new Date(pull.created_at).toLocaleDateString()}
              </span>
            </div>
            <input
              placeholder="Comment (optional for approve, required-ish for changes)"
              value={comment[pull.number] ?? ""}
              onChange={(e) => setComment((c) => ({ ...c, [pull.number]: e.target.value }))}
              className="mt-3 w-full rounded-lg border border-basalt-700 bg-basalt-950 px-3 py-2 text-sm outline-none focus:border-basalt-accent"
            />
            <div className="mt-2 flex gap-2">
              <button
                disabled={busy}
                onClick={() => review(pull, "APPROVE")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => review(pull, "REQUEST_CHANGES")}
                className="rounded-lg bg-basalt-700 px-3 py-1.5 text-xs font-medium hover:brightness-125 disabled:opacity-50"
              >
                Request changes
              </button>
              <button
                disabled={busy}
                onClick={() => review(pull, "COMMENT")}
                className="rounded-lg px-3 py-1.5 text-xs text-basalt-400 hover:text-basalt-200 disabled:opacity-50"
              >
                Comment only
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
