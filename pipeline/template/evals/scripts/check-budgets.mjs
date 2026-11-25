#!/usr/bin/env node
// Token-size budget gate. Zero deps.
//
//   node evals/scripts/check-budgets.mjs            fail on any file over budget / missing budget
//   node evals/scripts/check-budgets.mjs --init     seed budgets for every current file (current bytes × 1.1)
//
// Rules:
//   - Covers skills/*/SKILL.md, skills/*/references/*.md, skills/*/model-variants/*.md.
//   - A file with no budget entry FAILS — adding a file means adding a budget,
//     in the same PR, where a reviewer sees it. Raising one is the same act.
//   - Token estimates are bytes/4 — an approximation, deliberately cheap; the
//     ceiling is the contract, not the estimate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDGETS = path.join(ROOT, 'evals', 'budgets.json');
const HEADROOM = 1.1;

const files = [];
for (const skill of fs.readdirSync(path.join(ROOT, 'skills'))) {
  const dir = path.join(ROOT, 'skills', skill);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const name of ['SKILL.md', ...ls(path.join(dir, 'references')), ...ls(path.join(dir, 'model-variants'))]) {
    files.push(path.join('skills', skill, name));
  }
}
function ls(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.basename(dir) + '/' + f);
  } catch {
    return [];
  }
}

const budgets = JSON.parse(fs.readFileSync(BUDGETS, 'utf8'));
const init = process.argv.includes('--init');
let fail = false;

console.log(`file`.padEnd(58), `bytes`, `~tok`, `budget`);
for (const rel of files.sort()) {
  const bytes = fs.statSync(path.join(ROOT, rel)).size;
  const ceiling = budgets[rel];
  if (init || ceiling === undefined) {
    if (init) budgets[rel] = budgets[rel] ?? Math.round(bytes * HEADROOM); // add-only: a ratcheted-down budget is never raised by --init
    else {
      console.log(rel.padEnd(58), String(bytes).padStart(7), String(Math.ceil(bytes / 4)).padStart(6), 'MISSING — add to evals/budgets.json in this PR');
      fail = true;
    }
    continue;
  }
  const over = bytes > ceiling;
  fail ||= over;
  console.log(
    rel.padEnd(58),
    String(bytes).padStart(7),
    String(Math.ceil(bytes / 4)).padStart(6),
    String(ceiling).padStart(7) + (over ? '  ✗ OVER' : ''),
  );
}

if (init) {
  // drop stale entries (deleted files) when re-initializing
  for (const k of Object.keys(budgets)) if (!files.includes(k)) delete budgets[k];
  fs.writeFileSync(BUDGETS, JSON.stringify(budgets, null, 2) + '\n');
  console.log('\nbudgets.json updated: missing budgets added (bytes × 1.1), stale entries pruned. Existing budgets untouched.');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
