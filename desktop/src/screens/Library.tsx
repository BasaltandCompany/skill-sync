import { useEffect, useState } from "react";
import { getSkillFile, listSkills, searchSkills, type Skill } from "../lib/api";
import { marked } from "marked";

export default function Library() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listSkills()
      .then((r) => setSkills(r.skills))
      .catch((e) => setError(String(e.message)));
  }, []);

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
    <div className="flex h-full">
      <div className="w-80 shrink-0 overflow-auto border-r border-basalt-800 p-4">
        <input
          placeholder="Search skills…"
          onChange={(e) => onSearch(e.target.value)}
          className="mb-3 w-full rounded-lg border border-basalt-700 bg-basalt-950 px-3 py-2 text-sm outline-none focus:border-basalt-accent"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {skills.map((s) => (
          <button
            key={s.name}
            onClick={() => open(s)}
            className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
              selected?.name === s.name ? "bg-basalt-800" : "hover:bg-basalt-900"
            }`}
          >
            <div className="text-sm font-medium">{s.name}</div>
            <div className="line-clamp-2 text-xs text-basalt-400">{s.description}</div>
          </button>
        ))}
        {skills.length === 0 && !error && <p className="px-3 text-xs text-basalt-400">No skills yet.</p>}
      </div>
      <div className="flex-1 overflow-auto p-8">
        {selected ? (
          <>
            <h1 className="text-xl font-semibold">{selected.name}</h1>
            <p className="mt-1 text-sm text-basalt-400">{selected.description}</p>
            <div className="mt-4 flex gap-2">
              {selected.files
                .filter((f) => f !== "SKILL.md")
                .map((f) => (
                  <span key={f} className="rounded-md bg-basalt-800 px-2 py-1 text-xs text-basalt-200">
                    {f}
                  </span>
                ))}
            </div>
            <article
              className="prose prose-invert prose-sm mt-6 max-w-none"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </>
        ) : (
          <p className="text-basalt-400">Pick a skill.</p>
        )}
      </div>
    </div>
  );
}
