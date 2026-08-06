#!/usr/bin/env node
// Pull newly-added items from the Square catalog and write a briefing file
// that a blog post can be written from.
//
// Square has no "created_at" on catalog objects — begin_time filters on
// *modified* time, which also fires for price edits and restocks. So "new"
// is determined by diffing against a local set of item IDs we've already
// seen (scripts/.square-state.json), the same way the GBP script tracks
// which posts it has already pushed.
//
// For the full in-stock catalog (not just what's new), use
// pull-square-catalog.mjs instead — it deliberately does NOT touch the state
// file here, so a snapshot run can never destroy the new-items baseline.
//
// Usage:
//   node scripts/pull-square-new-items.mjs --reset       # first run: seed state, report nothing
//   node scripts/pull-square-new-items.mjs               # report items not seen before
//   node scripts/pull-square-new-items.mjs --dry-run     # report, but don't record them as seen
//   node scripts/pull-square-new-items.mjs --since=2026-07-01   # only fetch objects modified since
//   node scripts/pull-square-new-items.mjs --limit=15    # cap items in the brief
//   node scripts/pull-square-new-items.mjs --no-inventory        # skip stock lookup
//
// Credentials at scripts/.square-credentials.json:
//   { "accessToken": "EAAA...", "locationId": "L...", "environment": "production" }
// State at scripts/.square-state.json (auto-created).
// Output: scripts/.square-new-items.json  and  scripts/.square-new-items.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCreds, fetchItems, shapeItem, fetchInventory, applyStock,
} from './lib/square.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '.square-state.json');
const OUT_JSON = path.join(__dirname, '.square-new-items.json');
const OUT_MD = path.join(__dirname, '.square-new-items.md');

function args() {
  const out = {
    dryRun: false, reset: false, since: null, limit: null, inventory: true,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--reset') out.reset = true;
    else if (arg === '--no-inventory') out.inventory = false;
    else if (arg.startsWith('--since=')) out.since = arg.slice(8);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else { console.error(`Unknown arg: ${arg}`); process.exit(2); }
  }
  if (out.limit !== null && (!Number.isFinite(out.limit) || out.limit < 1)) {
    console.error('--limit must be a positive number');
    process.exit(2);
  }
  if (out.since && Number.isNaN(new Date(out.since).getTime())) {
    console.error('--since must be a parseable date, e.g. 2026-07-01');
    process.exit(2);
  }
  return out;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { seen: [], lastRun: null };
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!Array.isArray(s.seen)) s.seen = [];
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function stockLabel(item) {
  if (!item.stockKnown) return 'in stock (untracked)';
  return `${item.stock} on hand`;
}

function renderMarkdown(newItems, meta) {
  const lines = [];
  lines.push(`# New Square catalog items`);
  lines.push('');
  lines.push(`Pulled: ${meta.pulledAt}`);
  lines.push(`Catalog size: ${meta.catalogSize} items — ${newItems.length} not seen before.`);
  if (meta.since) lines.push(`Filtered to objects modified since: ${meta.since}`);
  if (meta.truncated) lines.push(`Showing first ${newItems.length} (use --limit to change).`);
  lines.push('');

  const byCategory = new Map();
  for (const item of newItems) {
    const key = item.categories[0] || 'Uncategorized';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(item);
  }

  for (const [category, items] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${category} (${items.length})`);
    lines.push('');
    for (const item of items) {
      const bits = [];
      if (item.price) bits.push(item.price);
      if (item.inStock !== undefined) bits.push(stockLabel(item));
      if (item.isArchived) bits.push('ARCHIVED');
      lines.push(`### ${item.name}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
      if (item.description) lines.push('', item.description);
      if (item.variations.length > 1) {
        lines.push('', 'Variations:');
        for (const v of item.variations) {
          lines.push(`- ${v.name || v.id}${v.price ? ` — ${v.price}` : ''}${v.sku ? ` (SKU ${v.sku})` : ''}`);
        }
      }
      if (item.images.length) lines.push('', `Images: ${item.images.map(i => i.url).join(' , ')}`);
      lines.push('');
    }
  }

  if (newItems.length === 0) {
    lines.push('_Nothing new since the last run._');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const opts = args();
  const creds = loadCreds();
  const state = loadState();
  const seen = new Set(state.seen);

  console.log(`ENV    ${creds.environment}`);
  console.log(`STATE  ${seen.size} items previously seen`);
  if (opts.since) console.log(`SINCE  ${opts.since}`);

  const { items, related } = await fetchItems(creds, opts.since);
  const shaped = items
    .map(o => shapeItem(o, related, creds.locationId))
    .filter(i => !i.isArchived);

  let newItems = shaped.filter(i => !seen.has(i.id));
  newItems.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const truncated = opts.limit !== null && newItems.length > opts.limit;
  if (truncated) newItems = newItems.slice(0, opts.limit);

  if (opts.reset) {
    const all = shaped.map(i => i.id);
    if (!opts.dryRun) {
      saveState({ seen: all, lastRun: new Date().toISOString() });
      console.log(`\nSeeded state with ${all.length} item IDs. Future runs report only what's added after this.`);
    } else {
      console.log(`\n--dry-run: would seed state with ${all.length} item IDs.`);
    }
    return;
  }

  if (opts.inventory && newItems.length) {
    const variationIds = newItems.flatMap(i => i.variations.map(v => v.id));
    if (variationIds.length) {
      try {
        const counts = await fetchInventory(creds, variationIds);
        for (const item of newItems) applyStock(item, counts);
      } catch (err) {
        console.warn(`\nInventory lookup failed (continuing without stock counts): ${err.message}`);
      }
    }
  }

  const meta = {
    pulledAt: new Date().toISOString(),
    catalogSize: shaped.length,
    since: opts.since,
    truncated,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify({ meta, items: newItems }, null, 2) + '\n');
  fs.writeFileSync(OUT_MD, renderMarkdown(newItems, meta));

  console.log(`\nNEW    ${newItems.length}${truncated ? ` (capped at --limit=${opts.limit})` : ''}`);
  for (const item of newItems.slice(0, 20)) {
    console.log(`  ${(item.price || '').padEnd(14)} ${item.name}`);
  }
  if (newItems.length > 20) console.log(`  ...and ${newItems.length - 20} more`);
  console.log(`\nWrote ${path.relative(process.cwd(), OUT_JSON)}`);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_MD)}`);

  if (opts.dryRun) {
    console.log('\n--dry-run: state not updated, these items will be reported again next run.');
  } else if (!truncated) {
    saveState({
      seen: [...seen, ...newItems.map(i => i.id)],
      lastRun: new Date().toISOString(),
    });
    console.log(`\nState updated: ${seen.size + newItems.length} items now marked seen.`);
  } else {
    console.log('\nState NOT updated because results were truncated by --limit.');
    console.log('Re-run without --limit to record everything as seen.');
  }
}

main().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
