#!/usr/bin/env node
// Snapshot the full Square catalog — everything currently sellable at the
// Terrell location — for grouping into social posts and blog content.
//
// This is deliberately a separate entry point from pull-square-new-items.mjs
// rather than a flag on it. That script's contract is "mutate
// scripts/.square-state.json"; a snapshot run that touched that file would
// destroy the new-items baseline permanently. Disjoint state, disjoint
// scripts.
//
// Usage:
//   node scripts/pull-square-catalog.mjs                    # write the snapshot
//   node scripts/pull-square-catalog.mjs --dry-run          # fetch and report, write nothing
//   node scripts/pull-square-catalog.mjs --require-tracked-stock
//   node scripts/pull-square-catalog.mjs --include-all-locations
//
// Credentials at scripts/.square-credentials.json (shared with the puller).
// Output: social/catalog-snapshot.json and social/catalog-snapshot.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCreds, fetchItems, shapeItem, fetchInventory, applyStock, stockBreakdown,
  SQUARE_VERSION,
} from './lib/square.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOCIAL_DIR = path.join(ROOT, 'social');
const OUT_JSON = path.join(SOCIAL_DIR, 'catalog-snapshot.json');
const OUT_MD = path.join(SOCIAL_DIR, 'catalog-snapshot.md');

function args() {
  const out = { dryRun: false, requireTracked: false, allLocations: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--require-tracked-stock') out.requireTracked = true;
    else if (arg === '--include-all-locations') out.allLocations = true;
    else { console.error(`Unknown arg: ${arg}`); process.exit(2); }
  }
  return out;
}

function renderMarkdown(items, meta) {
  const lines = [];
  lines.push('# Gugu Gifts — in-stock catalog snapshot');
  lines.push('');
  lines.push(`Pulled: ${meta.pulledAt}`);
  lines.push(`${meta.breakdown.line}`);
  lines.push('');
  lines.push('Prices here are live from Square and supersede any price written');
  lines.push('into an existing blog post. Item descriptions are usually vendor');
  lines.push('copy — treat them as facts to write from, not as publishable prose.');
  lines.push('');

  const byCategory = new Map();
  for (const item of items) {
    const key = item.categories[0] || 'Uncategorized';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(item);
  }

  for (const [category, group] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${category} (${group.length})`);
    lines.push('');
    group.sort((a, b) => (b.priceCents || 0) - (a.priceCents || 0));
    for (const item of group) {
      const bits = [];
      if (item.price) bits.push(item.price);
      bits.push(item.stockKnown ? `${item.stock} on hand` : 'untracked');
      if (item.images.length) bits.push(`${item.images.length} photo${item.images.length > 1 ? 's' : ''}`);
      lines.push(`- **${item.name}** — ${bits.join(', ')}  \`${item.id}\``);
      if (item.description) {
        const short = item.description.replace(/\s+/g, ' ').slice(0, 220);
        lines.push(`  ${short}${item.description.length > 220 ? '…' : ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const opts = args();
  const creds = loadCreds();

  console.log(`ENV    ${creds.environment}`);
  console.log(`LOC    ${creds.locationId || '(none set — stock spans all locations)'}`);
  if (!creds.locationId) {
    console.warn('  ! No locationId in credentials. Inventory counts will aggregate');
    console.warn('    across every location on the account, and per-location item');
    console.warn('    scoping cannot be applied.');
  }

  const { items, related } = await fetchItems(creds, null);
  let shaped = items
    .map(o => shapeItem(o, related, creds.locationId))
    .filter(i => !i.isArchived);

  const beforeLocation = shaped.length;
  if (!opts.allLocations) shaped = shaped.filter(i => i.presentAtLocation);
  const droppedForLocation = beforeLocation - shaped.length;

  const variationIds = shaped.flatMap(i => i.variations.map(v => v.id));
  console.log(`  resolving inventory for ${variationIds.length} variations...`);
  const counts = await fetchInventory(creds, variationIds);
  for (const item of shaped) applyStock(item, counts);

  const breakdown = stockBreakdown(shaped);
  console.log(`\n${breakdown.line}`);
  if (droppedForLocation) {
    console.log(`${droppedForLocation} item(s) excluded as not carried at this location.`);
  }

  let inStock = shaped.filter(i => i.inStock);
  if (opts.requireTracked) {
    const before = inStock.length;
    inStock = inStock.filter(i => i.stockKnown);
    console.log(`--require-tracked-stock: dropped ${before - inStock.length} untracked item(s).`);
  }

  // Sanity check the shape of the result before anything is built on it.
  if (inStock.length === 0) {
    console.error('\nNo in-stock items found. Check the access token scopes');
    console.error('(ITEMS_READ + INVENTORY_READ) and that locationId is correct.');
    process.exit(1);
  }
  if (breakdown.untracked === breakdown.total && breakdown.total > 0) {
    console.warn('\n! Every item is untracked. That is plausible for a shop that');
    console.warn('  does not use Square inventory, but it also looks exactly like');
    console.warn('  a token missing the INVENTORY_READ scope. Worth confirming.');
  }

  const withPhotos = inStock.filter(i => i.images.length).length;
  console.log(`${withPhotos}/${inStock.length} in-stock items have a product photo.`);

  const categories = [...new Set(inStock.flatMap(i => i.categories))]
    .map(name => ({ name, itemCount: inStock.filter(i => i.categories.includes(name)).length }))
    .sort((a, b) => b.itemCount - a.itemCount);

  const meta = {
    pulledAt: new Date().toISOString(),
    environment: creds.environment,
    locationId: creds.locationId || null,
    squareVersion: SQUARE_VERSION,
    catalogSize: shaped.length,
    inStockCount: inStock.length,
    withPhotos,
    breakdown,
  };

  if (opts.dryRun) {
    console.log('\n--dry-run: nothing written.');
    console.log(`Would write ${inStock.length} in-stock items across ${categories.length} categories.`);
    return;
  }

  fs.mkdirSync(SOCIAL_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ meta, categories, items: inStock }, null, 2) + '\n');
  fs.writeFileSync(OUT_MD, renderMarkdown(inStock, meta));

  console.log(`\nWrote ${path.relative(process.cwd(), OUT_JSON)}`);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_MD)}`);
}

main().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
