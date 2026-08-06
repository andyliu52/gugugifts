#!/usr/bin/env node
// Group the in-stock catalog snapshot into candidate themes for social posts.
//
// This is the MECHANICAL half of the job and it is deliberately dumb: it
// decides what belongs together, not what is worth posting or what the words
// should be. Grouping by Square category alone yields "Home Fragrance (47)",
// which is a category, not a theme — turning that into "Voluspa fall scents,
// the four that sell out first" needs judgement, so that lives in
// social/posts.json alongside the caption it travels with.
//
// Output is advisory and regenerable. Nothing downstream is gated on it;
// posts.json is the source of truth.
//
// Usage:
//   node scripts/group-catalog.mjs
//   node scripts/group-catalog.mjs --min=3 --max=8
//   node scripts/group-catalog.mjs --target-min=20 --target-max=40
//   node scripts/group-catalog.mjs --brands=Voluspa,Swig    # override brand list
//
// Reads:  social/catalog-snapshot.json
// Writes: social/groups.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'social', 'catalog-snapshot.json');
const OUT = path.join(ROOT, 'social', 'groups.json');

function args() {
  const out = { min: 3, max: 8, targetMin: 20, targetMax: 40, brands: null, suggest: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--suggest-brands') out.suggest = true;
    else if (a.startsWith('--min=')) out.min = Number(a.slice(6));
    else if (a.startsWith('--max=')) out.max = Number(a.slice(6));
    else if (a.startsWith('--target-min=')) out.targetMin = Number(a.slice(13));
    else if (a.startsWith('--target-max=')) out.targetMax = Number(a.slice(13));
    else if (a.startsWith('--brands=')) out.brands = a.slice(9).split(',').map(s => s.trim()).filter(Boolean);
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  for (const k of ['min', 'max', 'targetMin', 'targetMax']) {
    if (!Number.isFinite(out[k]) || out[k] < 1) {
      console.error(`--${k} must be a positive number`);
      process.exit(2);
    }
  }
  if (out.min > out.max) { console.error('--min cannot exceed --max'); process.exit(2); }
  return out;
}

// Brands carried in the shop, as they appear in Square item names.
//
// This is an explicit list on purpose. Deriving it from blog frontmatter tags
// was tried and is too noisy — the tags legitimately contain "Cinco de Mayo",
// "Thanksgiving", "I-20" and "Tanger Outlets", none of which are brands, and
// a false positive silently mis-groups every item whose name contains that
// word. Eight reviewable lines beat a clever heuristic here.
//
// Use --suggest-brands to mine the real catalog for candidates to add.
const BRANDS = [
  'Voluspa', 'Greenleaf', 'Birch & Bloom',
  'Swig', 'Govino',
  'Julie Vos', 'Rain',
  'Pampa Bay', 'Crow Canyon', 'Splendid Iris',
  'Kaweco', 'Glory Haus', 'Meri Meri',
];

// Mine repeated leading tokens out of the snapshot. Grounded in what the
// catalog actually says, unlike guessing from blog copy.
function suggestBrands(items) {
  const counts = new Map();
  for (const item of items) {
    const words = item.name.split(/\s+/).filter(Boolean);
    for (const n of [1, 2]) {
      if (words.length < n) continue;
      const phrase = words.slice(0, n).join(' ').replace(/[^A-Za-z0-9& ]/g, '');
      if (phrase.length < 3 || !/^[A-Z]/.test(phrase)) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([phrase, n]) => n >= 3 && !BRANDS.some(b => b.toLowerCase() === phrase.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
}

const slug = s => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function detectBrand(name, brands) {
  const lower = name.toLowerCase();
  // Longest match first so "Julie Vos" beats a hypothetical "Julie".
  for (const b of [...brands].sort((a, b) => b.length - a.length)) {
    if (lower.includes(b.toLowerCase())) return b;
  }
  return null;
}

// Split an oversized group into price bands. Tertiles keep each post's items
// in a comparable price bracket, which is what makes a caption writable —
// "under $25" is a theme, "these 22 candles" is not.
function splitByPrice(group, max) {
  const items = [...group.items].sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  const bands = Math.min(Math.ceil(items.length / max), 3);
  if (bands <= 1) return [group];
  const size = Math.ceil(items.length / bands);
  const labels = bands === 2 ? ['everyday', 'premium'] : ['under', 'mid', 'premium'];
  const out = [];
  for (let i = 0; i < bands; i++) {
    const chunk = items.slice(i * size, (i + 1) * size);
    if (!chunk.length) continue;
    const lo = chunk[0].price, hi = chunk[chunk.length - 1].price;
    out.push({
      ...group,
      groupId: `${group.groupId}-${labels[i]}`,
      label: `${group.label} — ${lo === hi ? lo : `${lo} to ${hi}`}`,
      items: chunk,
      splitFrom: group.groupId,
    });
  }
  return out;
}

function main() {
  const opts = args();

  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`Missing ${path.relative(process.cwd(), SNAPSHOT)}`);
    console.error('Run: npm run square:catalog');
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const items = snap.items || [];
  if (!items.length) { console.error('Snapshot contains no items.'); process.exit(1); }

  if (opts.suggest) {
    const found = suggestBrands(items);
    console.log(`Repeated name prefixes in the catalog not already in BRANDS:\n`);
    if (!found.length) console.log('  (none — the BRANDS list looks complete)');
    for (const [phrase, n] of found) console.log(`  ${String(n).padStart(3)}x  ${phrase}`);
    console.log('\nAdd any real brands to the BRANDS array in this script.');
    return;
  }

  const brands = opts.brands || BRANDS;
  console.log(`BRANDS  ${brands.join(', ')}`);
  console.log(`ITEMS   ${items.length} in stock`);

  // Key on brand when we recognise one, else the Square category.
  const buckets = new Map();
  for (const item of items) {
    const brand = detectBrand(item.name, brands);
    const category = item.categories[0] || 'Uncategorized';
    const key = brand ? `brand:${brand}` : `cat:${category}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        groupId: slug(brand || category),
        label: brand || category,
        kind: brand ? 'brand' : 'category',
        brand: brand || null,
        category,
        items: [],
      });
    }
    buckets.get(key).items.push(item);
  }

  let groups = [...buckets.values()];

  // Fold groups too small to carry a post back into their category.
  const small = groups.filter(g => g.items.length < opts.min);
  groups = groups.filter(g => g.items.length >= opts.min);
  const folded = new Map();
  for (const g of small) {
    const key = g.category;
    if (!folded.has(key)) {
      folded.set(key, {
        groupId: slug(`${key}-mixed`), label: `${key} — mixed`,
        kind: 'folded', brand: null, category: key, items: [],
      });
    }
    folded.get(key).items.push(...g.items);
  }
  for (const g of folded.values()) {
    if (g.items.length >= opts.min) groups.push(g);
    else console.log(`  dropped ${g.items.length} item(s) in "${g.category}" — too few to post`);
  }

  // Split groups too large to describe in one caption.
  groups = groups.flatMap(g => g.items.length > opts.max ? splitByPrice(g, opts.max) : [g]);

  // Denormalise what an author and the image builder need, so neither has to
  // re-open the snapshot.
  for (const g of groups) {
    const withPhoto = g.items.find(i => i.images.length);
    g.itemIds = g.items.map(i => i.id);
    g.photoCount = g.items.filter(i => i.images.length).length;
    g.suggestedImage = withPhoto
      ? { source: 'square', itemId: withPhoto.id, imageId: withPhoto.images[0].id, url: withPhoto.images[0].url }
      : null;
    g.priceLow = g.items.reduce((m, i) => Math.min(m, i.priceCents ?? Infinity), Infinity);
    g.items = g.items.map(i => ({
      id: i.id, name: i.name, price: i.price, priceCents: i.priceCents,
      stock: i.stock, stockKnown: i.stockKnown,
      imageId: i.images[0]?.id || null, imageUrl: i.images[0]?.url || null,
    }));
  }

  groups.sort((a, b) => b.items.length - a.items.length);

  console.log(`\n${groups.length} group(s):\n`);
  const pad = Math.max(...groups.map(g => g.label.length));
  for (const g of groups) {
    const photo = g.photoCount === g.items.length ? 'all'
      : g.photoCount === 0 ? 'NONE' : `${g.photoCount}/${g.items.length}`;
    console.log(`  ${g.label.padEnd(pad)}  ${String(g.items.length).padStart(3)} items  photos: ${photo}`);
  }

  const noPhoto = groups.filter(g => g.photoCount === 0);
  if (noPhoto.length) {
    console.log(`\n${noPhoto.length} group(s) have no product photo and will need a`);
    console.log('gallery photo from src/assets/gallery/ or a generated scene.');
  }

  fs.writeFileSync(OUT, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      snapshotPulledAt: snap.meta?.pulledAt || null,
      brands, min: opts.min, max: opts.max, groupCount: groups.length,
    },
    groups,
  }, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);

  if (groups.length < opts.targetMin || groups.length > opts.targetMax) {
    console.error(`\n! ${groups.length} groups is outside the target ${opts.targetMin}-${opts.targetMax}.`);
    console.error(`  Tune --min / --max (currently ${opts.min} / ${opts.max}) and re-run.`);
    console.error('  The file was still written so you can inspect it.');
    process.exit(1);
  }
}

main();
