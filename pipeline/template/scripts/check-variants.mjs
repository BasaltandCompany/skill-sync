#!/usr/bin/env node
// Variant routing checker. Zero deps.
// 1. Every skills/*/SKILL.md must have a "## Model variants" section.
// 2. Every model-variants/<family>.md referenced there must exist and be non-empty.
// 3. No orphan overlays: every file under model-variants/ must be referenced.
// 4. Overlay families must be in evals/model-matrix.json.
// Routing is behavioral on top of structural: each model still runs the full
// eval matrix for its skill, so an overlay that misleads a model fails evals.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const families = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals/model-matrix.json'), 'utf8')).families;
let fail = false;

for (const skill of fs.readdirSync(path.join(ROOT, 'skills')).sort()) {
  const dir = path.join(ROOT, 'skills', skill);
  const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const section = skillMd.match(/^## Model variants\n((?:(?!^## )[\s\S])*)/m);
  if (!section) {
    console.log(`✗ ${skill}: SKILL.md has no "## Model variants" section`);
    fail = true;
    continue;
  }

  const referenced = [...section[1].matchAll(/model-variants\/([\w.-]+)\.md/g)].map((m) => m[1]);
  const onDisk = (() => {
    try {
      return fs.readdirSync(path.join(dir, 'model-variants')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  })();

  for (const fam of referenced) {
    if (!families.includes(fam)) {
      console.log(`✗ ${skill}: overlay "${fam}" is not in evals/model-matrix.json`);
      fail = true;
    }
    const p = path.join(dir, 'model-variants', `${fam}.md`);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      console.log(`✗ ${skill}: referenced overlay model-variants/${fam}.md is missing or empty`);
      fail = true;
    }
  }
  for (const fam of onDisk) {
    if (!referenced.includes(fam)) {
      console.log(`✗ ${skill}: orphan overlay model-variants/${fam}.md not named in the routing section`);
      fail = true;
    }
    const overlay = fs.readFileSync(path.join(dir, 'model-variants', `${fam}.md`), 'utf8');
    if (/^\s*---\n/.test(overlay)) {
      console.log(`✗ ${skill}: ${fam}.md must not have frontmatter (it is an overlay, not a skill)`);
      fail = true;
    }
  }
  if (!fail) console.log(`✓ ${skill}: routing ok${onDisk.length ? ` (overlays: ${onDisk.join(', ')})` : ' (base only)'}`);
}
process.exit(fail ? 1 : 0);
