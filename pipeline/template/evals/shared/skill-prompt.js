// Shared prompt function for every skill eval. Builds the [system, user] pair:
//   system = the skill's SKILL.md + any model-variant overlays + plan instructions
//   user   = the task from the test's `task` var
//
// Resolve paths from this file's location so the eval works from any cwd.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FAMILIES = ['haiku-4-5', 'sonnet-4-5', 'opus-4-5'];

// Skill text contains literal {{param:key}} syntax (Smart Docs placeholders).
// promptfoo runs Nunjucks over the rendered prompt and would choke on it;
// this escapes {{ so it renders back to a literal {{.
const escapeNunjucks = (s) => s.replaceAll('{{', '{{ "{" + "{" }}');
// The host (Claude Code / Cowork) tells the model its family in the system
// prompt; a bare API call doesn't. Mirror the host so routing behaves as it
// does in production — promptfoo passes the provider in context.provider.
function identityLine(providerId) {
  const id = String(providerId ?? '');
  const m = id.match(/claude-(haiku|sonnet|opus)-/);
  if (!m) return 'You are Claude working at your organization with the following skill loaded as your operating instructions.';
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return `You are Claude ${name} 4.5 working at your organization with the following skill loaded as your operating instructions.`;
}

module.exports = function skillPrompt(context) {
  const vars = (context && context.vars) || {};
  const dir = path.join(REPO_ROOT, String(vars.skillDir || ''));
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const skill = read('SKILL.md');
  if (!skill) {
    throw new Error(`skill-prompt: no SKILL.md under ${dir}`);
  }

  let overlays = '';
  for (const fam of FAMILIES) {
    const overlay = read(path.join('model-variants', `${fam}.md`));
    if (overlay) {
      overlays += `\nMODEL VARIANT OVERLAY (${fam}): if you are a ${
        fam.split('-')[0]
      }-class model you MUST also apply the overlay below. Where it restates a base rule, follow the overlay's phrasing.\n<overlay model="${fam}">\n${overlay}\n</overlay>\n`;
    }
  }

  const system = [
    identityLine(context?.provider?.id) + ' Follow it exactly, including its guardrails (confirmation gates, tool choice, ordering, metadata rules).',
    '<skill>',
    escapeNunjucks(skill),
    '</skill>',
    escapeNunjucks(overlays),
    'No tools are connected in this exercise, so do not attempt real calls. For the request below, output the plan you would execute: the exact tool calls with their key arguments, in order, one line of reasoning each. Keep it under ~400 words — sketch SQL and template/content shapes in one line each, but always NAME the literal values a step uses (e.g. "prove the past-due query with threshold 1000"); never write out full HTML, JSON bodies, or complete queries. Apply the skill confirmation/asking rules exactly as written: where a rule says confirm before a destructive or live action, state what you would lay out for the user and that you stop for their yes. Never refuse to plan because tools are unavailable — include download/verify/run steps as ordinary plan steps. Never re-ask for details the task already provided. Otherwise do NOT ask clarifying questions — the task contains everything needed; make reasonable assumptions, state them in one line, and produce the plan. Be concrete and brief.',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: String(vars.task) },
  ];
};
