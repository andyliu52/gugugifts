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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = path.join(__dirname, '.square-credentials.json');
const STATE_PATH = path.join(__dirname, '.square-state.json');
const OUT_JSON = path.join(__dirname, '.square-new-items.json');
const OUT_MD = path.join(__dirname, '.square-new-items.md');

const SQUARE_VERSION = '2026-07-15';
const HOSTS = {
  production: 'https://connect.squareup.com',
  sandbox: 'https://connect.squareupsandbox.com',
};

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

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error(`Missing credentials file: ${CREDS_PATH}`);
    console.error(`Expected JSON: { accessToken, locationId, environment }`);
    console.error(`Get an access token at https://developer.squareup.com/apps -> your app -> Credentials.`);
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  if (!c.accessToken) { console.error('Missing field in credentials: accessToken'); process.exit(1); }
  c.environment = c.environment || 'production';
  if (!HOSTS[c.environment]) {
    console.error(`environment must be "production" or "sandbox", got: ${c.environment}`);
    process.exit(1);
  }
  return c;
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

async function squarePost(creds, apiPath, body) {
  const res = await fetch(`${HOSTS[creds.environment]}${apiPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${apiPath} ${res.status}: ${text}`);
  return JSON.parse(text);
}

// Page through POST /v2/catalog/search for ITEM objects, collecting related
// CATEGORY and IMAGE objects so we can resolve names and image URLs.
async function fetchItems(creds, since) {
  const items = [];
  const related = new Map();
  let cursor;
  let page = 0;

  do {
    const body = {
      object_types: ['ITEM'],
      include_related_objects: true,
      limit: 200,
    };
    if (cursor) body.cursor = cursor;
    if (since) body.begin_time = new Date(since).toISOString();

    const json = await squarePost(creds, '/v2/catalog/search', body);
    for (const o of json.objects || []) items.push(o);
    for (const o of json.related_objects || []) related.set(o.id, o);
    cursor = json.cursor;
    page++;
    process.stdout.write(`\r  fetched ${items.length} items (page ${page})...`);
  } while (cursor);

  process.stdout.write('\n');
  return { items, related };
}

// Square returns money in the smallest currency unit (cents for USD).
function formatMoney(money) {
  if (!money || typeof money.amount !== 'number') return null;
  const value = money.amount / 100;
  const currency = money.currency || 'USD';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return value % 1 === 0 ? `${symbol}${value}` : `${symbol}${value.toFixed(2)}`;
}

function priceRange(variations) {
  const amounts = variations
    .map(v => v.item_variation_data?.price_money)
    .filter(m => m && typeof m.amount === 'number');
  if (amounts.length === 0) return null;
  const sorted = [...amounts].sort((a, b) => a.amount - b.amount);
  const low = formatMoney(sorted[0]);
  const high = formatMoney(sorted[sorted.length - 1]);
  return low === high ? low : `${low}–${high}`;
}

function shapeItem(obj, related) {
  const d = obj.item_data || {};
  const variations = d.variations || [];

  const categories = (d.categories || [])
    .map(c => related.get(c.id)?.category_data?.name)
    .filter(Boolean);

  const images = (d.image_ids || [])
    .map(id => related.get(id)?.image_data?.url)
    .filter(Boolean);

  return {
    id: obj.id,
    name: d.name || '(unnamed)',
    description: (d.description_plaintext || d.description || '').trim() || null,
    categories,
    price: priceRange(variations),
    variations: variations.map(v => ({
      id: v.id,
      name: v.item_variation_data?.name || null,
      sku: v.item_variation_data?.sku || null,
      price: formatMoney(v.item_variation_data?.price_money),
      trackInventory: v.item_variation_data?.track_inventory ?? null,
    })),
    images,
    isArchived: d.is_archived === true,
    updatedAt: obj.updated_at || null,
  };
}

// Batch-retrieve on-hand counts so the brief can say what's actually sellable.
async function fetchInventory(creds, variationIds) {
  const counts = new Map();
  const CHUNK = 500;

  for (let i = 0; i < variationIds.length; i += CHUNK) {
    const chunk = variationIds.slice(i, i + CHUNK);
    let cursor;
    do {
      const body = { catalog_object_ids: chunk };
      if (creds.locationId) body.location_ids = [creds.locationId];
      if (cursor) body.cursor = cursor;

      const json = await squarePost(creds, '/v2/inventory/counts/batch-retrieve', body);
      for (const c of json.counts || []) {
        if (c.state !== 'IN_STOCK') continue;
        const qty = Number(c.quantity) || 0;
        counts.set(c.catalog_object_id, (counts.get(c.catalog_object_id) || 0) + qty);
      }
      cursor = json.cursor;
    } while (cursor);
  }
  return counts;
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
      if (item.stock !== undefined && item.stock !== null) bits.push(`${item.stock} on hand`);
      if (item.isArchived) bits.push('ARCHIVED');
      lines.push(`### ${item.name}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
      if (item.description) lines.push('', item.description);
      if (item.variations.length > 1) {
        lines.push('', 'Variations:');
        for (const v of item.variations) {
          lines.push(`- ${v.name || v.id}${v.price ? ` — ${v.price}` : ''}${v.sku ? ` (SKU ${v.sku})` : ''}`);
        }
      }
      if (item.images.length) lines.push('', `Images: ${item.images.join(' , ')}`);
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
  const shaped = items.map(o => shapeItem(o, related)).filter(i => !i.isArchived);

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
        for (const item of newItems) {
          const total = item.variations.reduce((sum, v) => sum + (counts.get(v.id) || 0), 0);
          item.stock = total;
        }
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
