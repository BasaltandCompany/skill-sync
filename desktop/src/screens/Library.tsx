import { createSignal, For, Show } from "solid-js";
import { getSkillFile, listSkills, searchSkills, type Skill } from "../lib/api";
import { Badge, Input } from "@basaltac/ui";
import { marked } from "marked";

export default function Library() {
  const [skills, setSkills] = createSignal<Skill[]>([]);
  const [selected, setSelected] = createSignal<Skill | null>(null);
  const [content, setContent] = createSignal("");
  const [error, setError] = createSignal("");

  listSkills()
    .then((r) => setSkills(r.skills))
    .catch((e) => setError(String(e.message)));

  async function open(skill: Skill) {
    setSelected(skill);
    setContent("Loading…");
    try {
      const file = await getSkillFile(skill.name);
      setContent(await marked.parse(file.content));
    } catch (e: any) {
      setContent(`Error: ${e.message}`);
    }
  }

  async function onSearch(q: string) {
    if (!q.trim()) {
      listSkills().then((r) => setSkills(r.skills));
      return;
    }
    try {
      const r = await searchSkills(q);
      setSkills(r.skills);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div class="flex h-full">
      <div class="w-80 shrink-0 overflow-auto border-r border-border p-4">
        <Input placeholder="Search skills…" onInput={(e) => onSearch(e.currentTarget.value)} />
        <Show when={error()}>
          <p class="mt-2 text-xs text-destructive">{error()}</p>
        </Show>
        <div class="mt-3">
          <For each={skills()}>
            {(s) => (
              <button
                type="button"
                onClick={() => open(s)}
                class={`mb-1 block w-full px-3 py-2 text-left transition-colors ${
                  selected()?.name === s.name ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                <div class="text-sm font-medium">{s.name}</div>
                <div class="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
              </button>
            )}
          </For>
          <Show when={skills().length === 0 && !error()}>
            <p class="px-3 text-xs text-muted-foreground">No skills yet.</p>
          </Show>
        </div>
      </div>
      <div class="flex-1 overflow-auto p-8">
        <Show when={selected()} fallback={<p class="text-muted-foreground">Pick a skill.</p>}>
          {(s) => (
            <>
              <h1 class="font-heading text-xl">{s().name}</h1>
              <p class="mt-1 text-sm text-muted-foreground">{s().description}</p>
              <div class="mt-4 flex flex-wrap gap-2">
                <For each={s().files.filter((f) => f !== "SKILL.md")}>
                  {(f) => <Badge variant="secondary">{f}</Badge>}
                </For>
              </div>
              <article
                class="prose prose-invert prose-sm mt-6 max-w-none"
                innerHTML={content()}
              />
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
