import { createSignal, For, Show } from "solid-js";
import { listPulls, reviewPull, type Pull } from "../lib/api";
import { Button, Input } from "@basaltac/ui";

export default function Review() {
  const [pulls, setPulls] = createSignal<Pull[]>([]);
  const [error, setError] = createSignal("");
  const [comment, setComment] = createSignal<Record<number, string>>({});
  const [busy, setBusy] = createSignal(false);

  async function refresh() {
    try {
      const r = await listPulls();
      setPulls(r.pulls);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  refresh();

  async function review(pull: Pull, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
    setBusy(true);
    try {
      await reviewPull(pull.number, event, comment()[pull.number]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="max-w-2xl p-8">
      <h1 class="font-heading text-lg">Review</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Open skill-change PRs. Approval routing runs through CODEOWNERS on the repo — this is the same review, in-app.
      </p>
      <Show when={error()}>
        <p class="mt-3 text-xs text-destructive">{error()}</p>
      </Show>

      <div class="mt-6 space-y-3">
        <Show when={pulls().length === 0 && !error()}>
          <p class="text-sm text-muted-foreground">Nothing open.</p>
        </Show>
        <For each={pulls()}>
          {(pull) => (
            <div class="border border-border bg-card p-4">
              <div class="flex items-baseline justify-between gap-4">
                <a href={pull.html_url} class="text-sm font-medium hover:text-primary/70">
                  #{pull.number} {pull.title}
                </a>
                <span class="text-xs text-muted-foreground">
                  {pull.author} · {new Date(pull.created_at).toLocaleDateString()}
                </span>
              </div>
              <Input
                class="mt-3"
                placeholder="Comment (optional for approve)"
                value={comment()[pull.number] ?? ""}
                onInput={(e) => setComment((c) => ({ ...c, [pull.number]: e.currentTarget.value }))}
              />
              <div class="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy()}
                  onClick={() => review(pull, "APPROVE")}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy()}
                  onClick={() => review(pull, "REQUEST_CHANGES")}
                >
                  Request changes
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy()}
                  onClick={() => review(pull, "COMMENT")}
                >
                  Comment only
                </Button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
