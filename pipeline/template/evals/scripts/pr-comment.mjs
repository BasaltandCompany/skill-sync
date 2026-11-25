#!/usr/bin/env node
// Posts a promptfoo results summary comment on the PR. Zero deps (node 22 fetch).
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR; argv[2] = results dir (default results/).
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'results';
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (files.length === 0) process.exit(0);

let overallFail = false;
const sections = [];
for (const f of files) {
  const skill = path.basename(f, '.json');
  let r;
  try {
    r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    sections.push(`### ${skill}\n⚠️ unreadable results file`);
    overallFail = true;
    continue;
  }
  const stats = r.results?.stats ?? {};
  const total = (stats.successes ?? 0) + (stats.failures ?? 0) + (stats.errors ?? 0);
  const bad = (stats.failures ?? 0) + (stats.errors ?? 0);
  overallFail ||= bad > 0;

  let body = `### ${skill} — ${bad === 0 ? '✅ all green' : '❌ ' + bad + ' failing'} (${total} runs)\n`;
  const seen = new Set();
  for (const res of r.results?.results ?? []) {
    const ok = res.success && !res.error;
    if (ok) continue;
    const name = res.testCase?.description || '(unnamed case)';
    const provider = (res.provider?.id || res.provider?.label || 'provider').replace(/^.*[:/]/, '');
    const reason = res.error || res.failureReason || (res.testResult?.[0]?.reason ?? '');
    const key = name + provider;
    if (seen.has(key)) continue;
    seen.add(key);
    body += `- ❌ **${name}** (${provider}): ${String(reason).slice(0, 240).replace(/\n/g, ' ')}\n`;
  }
  if (r.shareableUrl) body += `\n📊 [View this run in the promptfoo visualizer](${r.shareableUrl})\n`;
  sections.push(body);
}

const header = overallFail
  ? '## 🧪 Skill evals — FAILED\n\nEvals must pass before merge (the `gate` check enforces this).'
  : '## 🧪 Skill evals — all green\n\nModel matrix: Sonnet 4.5 · Opus 4.5 · Haiku 4.5.';
const body = header + '\n\n' + sections.join('\n');

// Local mode (no GITHUB_TOKEN/GITHUB_PR): print the summary, exit on the verdict.
if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_PR) {
  console.log(body);
  process.exit(overallFail ? 1 : 0);
}
const payload = { body };

const res = await fetch(
  `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues/${process.env.GITHUB_PR}/comments`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  },
);
if (!res.ok) {
  console.error(`comment post failed: ${res.status} ${await res.text()}`);
  process.exit(0); // comment failure must not flip the gate either way
}
console.log('PR comment posted.');
process.exit(overallFail ? 1 : 0);
