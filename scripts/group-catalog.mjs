#!/usr/bin/env node
// Group the in-stock catalog snapshot into candidate themes for social posts.
//
// This is the MECHANICAL half of the job and it is deliberately dumb: it
// decides what belongs together, not what is worth posting or what the words
// should be. That judgement lives in social/posts.json alongside the caption
// it travels with. Output here is advisory and regenerable.
//
// Shape of the real catalog, which drove the design:
//   - 1789 in-stock items, 31 categories, but 663 items (37%) UNCATEGORIZED.
//   - Where a category exists it IS the brand ("Splendid Iris", "Rain
//     Jewelry", "Julie Vos"), and item names are product descriptors
//     ("Silver Blue Butterfly Earring") with no brand token.
//   - Uncategorized items are the reverse: the brand leads the name
//     ("KAWECO ...", "OSCOLABO stamp ...", "Swig Life 22oz ...").
//   So: trust the merchant's category first, fall back to name-brand only
//   when there is no category.
//
// Usage:
//   node scripts/group-catalog.mjs
//   node scripts/group-catalog.mjs --min=20 --max=90   # tuned defaults
//   node scripts/group-catalog.mjs --suggest-brands     # mine unmatched names
//   node scripts/group-catalog.mjs --show-excluded      # list dropped trade SKUs
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

// Brands that appear at the START of an item name, for the uncategorized 37%.
// Explicit rather than derived: deriving from blog tags was tried and pulled
// "Cinco de Mayo", "Thanksgiving" and "TxDOT" in as brands, and a false
// positive silently mis-groups every item containing that word.
// Use --suggest-brands to find candidates in the actual catalog.
const BRANDS = [
  // Japanese stationery
  'OSCOLABO', 'SHACHIHATA', 'PAPIER PLATZ', 'SANBY', 'LACONIC', 'LUDDITE', 'KAWECO',
  // home fragrance
  'Voluspa', 'Greenleaf', 'Birch & Bloom',
  // drinkware
  'Swig Life', 'Swig', 'Govino',
  // jewelry & accessories
  'Julie Vos', 'Lucky Feather', 'Pretty Simple',
  // tabletop & home
  'Pampa Bay', 'Crow Canyon', 'Nordic Ware', "Fletchers' Mill", 'K&K Interiors',
  // baby & kids
  'Milkbarn', 'Meri Meri',
  // paper & gift
  'Twos Company', "Two's Company", 'Freshcut', 'Glory Haus',
  // surfaced by --suggest-brands against the live catalog
  'Living Royal', 'Kay Dee', 'Mixologie', 'Aspen',
];

// Retail-only. These are supplier pack, display and sample SKUs that live in
// the same catalog but are not things a customer can buy — posting
// "Set/24 Assorted bracelets, $3" or a "$0.02 FREE 12PC Counter Display"
// would be actively misleading.
const TRADE_PATTERNS = [
  /\bset\/\d+/i,
  /pre-?pack/i,
  /\bdisplay\b/i,
  /\bfree\s*\d+\s*pc/i,
  /\bassorted\b/i,
  /\bMOQ\b/i,
  /\btester\b/i,
];

// Product nouns used to split an oversized brand into postable themes.
// Ordered longest-first so "Demi Necklace" doesn't match as "Necklace" before
// a more specific token gets a chance.
const PRODUCT_TYPES = [
  'Bangle', 'Bracelet', 'Earring', 'Necklace', 'Pendant', 'Ring', 'Charm',
  'Keychain', 'Candle', 'Diffuser', 'Mug', 'Tumbler', 'Bottle', 'Stamp',
  'Notebook', 'Journal', 'Card', 'Pen', 'Bag', 'Socks', 'Sticker', 'Tape',
];

function args() {
  const out = {
    min: 20, max: 90, targetMin: 20, targetMax: 40,
    suggest: false, showExcluded: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--suggest-brands') out.suggest = true;
    else if (a === '--show-excluded') out.showExcluded = true;
    else if (a.startsWith('--min=')) out.min = Number(a.slice(6));
    else if (a.startsWith('--max=')) out.max = Number(a.slice(6));
    else if (a.startsWith('--target-min=')) out.targetMin = Number(a.slice(13));
    else if (a.startsWith('--target-max=')) out.targetMax = Number(a.slice(13));
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  for (const k of ['min', 'max', 'targetMin', 'targetMax']) {
    if (!Number.isFinite(out[k]) || out[k] < 1) {
      console.error(`--${k} must be a positive number`); process.exit(2);
    }
  }
  if (out.min > out.max) { console.error('--min cannot exceed --max'); process.exit(2); }
  return out;
}

const slug = s => String(s).toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 60);

const isTrade = name => TRADE_PATTERNS.some(re => re.test(name));

function detectBrand(name) {
  const lower = name.toLowerCase();
  for (const b of [...BRANDS].sort((a, b) => b.length - a.length)) {
    if (lower.startsWith(b.toLowerCase())) return b;
  }
  for (const b of [...BRANDS].sort((a, b) => b.length - a.length)) {
    if (lower.includes(b.toLowerCase())) return b;
  }
  return null;
}

function detectType(name) {
  const lower = name.toLowerCase();
  for (const t of PRODUCT_TYPES) {
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

// Normalise the merchant's inconsistent casing ("swig" vs "Swig Life",
// "Rain" vs "Rain Jewelry") so they don't become separate groups.
function canonicalLabel(label) {
  const fixes = {
    'swig': 'Swig', 'rain': 'Rain Jewelry', 'cardthartic': 'Cardthartic',
    'mary square': 'Mary Square', 'jillson roberts': 'Jillson Roberts',
  };
  return fixes[label.toLowerCase()] || label;
}

function suggestBrands(items) {
  const counts = new Map();
  for (const item of items) {
    if (detectBrand(item.name)) continue;
    const words = item.name.split(/\s+/).filter(Boolean);
    for (const n of [1, 2]) {
      if (words.length < n) continue;
      const phrase = words.slice(0, n).join(' ').replace(/[^A-Za-z0-9&' ]/g, '').trim();
      if (phrase.length < 3 || !/^[A-Z]/.test(phrase)) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1]).slice(0, 30);
}

// Split an oversized group. Product type is the natural axis for this
// catalog ("Rain Jewelry earrings" is a theme); price band is the fallback
// when names carry no usable noun.
function splitGroup(group, max) {
  const byType = new Map();
  let untyped = 0;
  for (const item of group.items) {
    const t = detectType(item.name);
    if (!t) { untyped++; continue; }
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(item);
  }

  const typedShare = (group.items.length - untyped) / group.items.length;
  if (byType.size >= 2 && typedShare >= 0.6) {
    const out = [];
    const leftovers = group.items.filter(i => !detectType(i.name));
    for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
      out.push({
        ...group,
        groupId: `${group.groupId}-${slug(type)}`,
        label: `${group.label} — ${type}s`,
        items: list,
        splitFrom: group.groupId,
        splitBy: 'type',
      });
    }
    if (leftovers.length) {
      out.push({
        ...group, groupId: `${group.groupId}-more`, label: `${group.label} — more`,
        items: leftovers, splitFrom: group.groupId, splitBy: 'type',
      });
    }
    // Recurse once so a still-oversized type bucket gets price-banded.
    return out.flatMap(g => g.items.length > max ? splitByPrice(g, max) : [g]);
  }
  return splitByPrice(group, max);
}

function splitByPrice(group, max) {
  const items = [...group.items].sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  const bands = Math.min(Math.ceil(items.length / max), 3);
  if (bands <= 1) return [group];
  const size = Math.ceil(items.length / bands);
  const out = [];
  for (let i = 0; i < bands; i++) {
    const chunk = items.slice(i * size, (i + 1) * size);
    if (!chunk.length) continue;
    const lo = chunk[0].price, hi = chunk[chunk.length - 1].price;
    out.push({
      ...group,
      groupId: `${group.groupId}-band${i + 1}`,
      label: `${group.label} — ${lo === hi ? lo : `${lo} to ${hi}`}`,
      items: chunk, splitFrom: group.groupId, splitBy: 'price',
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
  const all = snap.items || [];
  if (!all.length) { console.error('Snapshot contains no items.'); process.exit(1); }

  const excluded = all.filter(i => isTrade(i.name));
  const items = all.filter(i => !isTrade(i.name));

  if (opts.showExcluded) {
    console.log(`${excluded.length} trade/wholesale SKU(s) excluded:\n`);
    for (const i of excluded) console.log(`  ${(i.price || '').padEnd(9)} ${i.name}`);
    return;
  }
  if (opts.suggest) {
    const found = suggestBrands(items);
    console.log('Frequent name prefixes with no BRANDS match:\n');
    if (!found.length) console.log('  (none)');
    for (const [phrase, n] of found) console.log(`  ${String(n).padStart(4)}x  ${phrase}`);
    console.log('\nAdd real brands to the BRANDS array in this script.');
    return;
  }

  console.log(`ITEMS     ${all.length} in stock`);
  console.log(`EXCLUDED  ${excluded.length} trade/wholesale SKUs (--show-excluded to list)`);

  // Category first — it is the merchant's own grouping and it is the brand.
  // Name-brand only for the uncategorized remainder.
  const buckets = new Map();
  let viaCategory = 0, viaBrand = 0, viaNothing = 0;
  for (const item of items) {
    const category = item.categories[0];
    let label, kind;
    if (category) { label = canonicalLabel(category); kind = 'category'; viaCategory++; }
    else {
      const brand = detectBrand(item.name);
      if (brand) { label = brand; kind = 'brand'; viaBrand++; }
      else { label = 'Other gifts'; kind = 'unmatched'; viaNothing++; }
    }
    const key = label.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, { groupId: slug(label), label, kind, category: category || null, items: [] });
    }
    buckets.get(key).items.push(item);
  }
  console.log(`GROUPED   ${viaCategory} by category, ${viaBrand} by name-brand, ${viaNothing} unmatched`);

  let groups = [...buckets.values()];

  // Fold groups too small to carry a post into a single mixed bucket.
  const small = groups.filter(g => g.items.length < opts.min && g.kind !== 'unmatched');
  groups = groups.filter(g => !(g.items.length < opts.min && g.kind !== 'unmatched'));
  if (small.length) {
    const merged = small.flatMap(g => g.items);
    const existing = groups.find(g => g.kind === 'unmatched');
    if (existing) existing.items.push(...merged);
    else groups.push({ groupId: 'other-gifts', label: 'Other gifts', kind: 'unmatched', category: null, items: merged });
    console.log(`FOLDED    ${small.length} small group(s) (${merged.length} items) into "Other gifts"`);
  }

  groups = groups.flatMap(g => g.items.length > opts.max ? splitGroup(g, opts.max) : [g]);

  // Splitting by product type leaves long-tail fragments — a brand with two
  // pendants and one charm. Re-fold anything under --min back into a single
  // sibling bucket for that brand rather than emitting a post about one ring.
  const bySplitParent = new Map();
  for (const g of groups) {
    if (!g.splitFrom || g.items.length >= opts.min) continue;
    if (!bySplitParent.has(g.splitFrom)) bySplitParent.set(g.splitFrom, []);
    bySplitParent.get(g.splitFrom).push(g);
  }
  if (bySplitParent.size) {
    let refolded = 0;
    for (const [parent, frags] of bySplitParent) {
      const fragIds = new Set(frags.map(f => f.groupId));
      groups = groups.filter(g => !fragIds.has(g.groupId));
      const merged = frags.flatMap(f => f.items);
      const sibling = groups.find(g => g.splitFrom === parent && g.groupId.endsWith('-more'));
      if (sibling) sibling.items.push(...merged);
      else {
        const any = frags[0];
        groups.push({
          groupId: `${parent}-more`, label: `${any.label.split(' — ')[0]} — more`,
          kind: any.kind, category: any.category, items: merged,
          splitFrom: parent, splitBy: 'refold',
        });
      }
      refolded += merged.length;
    }
    console.log(`REFOLDED  ${refolded} item(s) from undersized split fragments`);
  }

  for (const g of groups) {
    const withPhoto = g.items.find(i => i.images.length);
    g.itemIds = g.items.map(i => i.id);
    g.photoCount = g.items.filter(i => i.images.length).length;
    g.suggestedImage = withPhoto
      ? { source: 'square', itemId: withPhoto.id, imageId: withPhoto.images[0].id, url: withPhoto.images[0].url }
      : null;
    const cents = g.items.map(i => i.priceCents).filter(Number.isFinite);
    g.priceLowCents = cents.length ? Math.min(...cents) : null;
    g.priceHighCents = cents.length ? Math.max(...cents) : null;
    // Featured = has a photo, mid-to-upper price. A caption names 3-5 items,
    // not the whole group, and the ones with photography are the postable ones.
    g.featured = [...g.items]
      .filter(i => i.images.length)
      .sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0))
      .slice(0, 5)
      .map(i => ({ id: i.id, name: i.name, price: i.price, imageId: i.images[0].id, imageUrl: i.images[0].url }));
    g.items = g.items.map(i => ({
      id: i.id, name: i.name, price: i.price, priceCents: i.priceCents,
      stock: i.stock, stockKnown: i.stockKnown,
      imageId: i.images[0]?.id || null, imageUrl: i.images[0]?.url || null,
    }));
  }

  groups.sort((a, b) => b.items.length - a.items.length);

  console.log(`\n${groups.length} group(s):\n`);
  const pad = Math.min(46, Math.max(...groups.map(g => g.label.length)));
  for (const g of groups) {
    const photo = g.photoCount === 0 ? 'NONE'
      : g.photoCount === g.items.length ? 'all' : `${g.photoCount}/${g.items.length}`;
    const price = g.priceLowCents != null
      ? `$${(g.priceLowCents / 100).toFixed(0)}-${(g.priceHighCents / 100).toFixed(0)}` : '-';
    console.log(`  ${g.label.slice(0, pad).padEnd(pad)} ${String(g.items.length).padStart(4)}  ${price.padEnd(10)} photos: ${photo}`);
  }

  const noPhoto = groups.filter(g => g.photoCount === 0);
  if (noPhoto.length) {
    console.log(`\n${noPhoto.length} group(s) have no product photo — they need a gallery`);
    console.log('photo from src/assets/gallery/ or a generated scene.');
  }

  fs.writeFileSync(OUT, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      snapshotPulledAt: snap.meta?.pulledAt || null,
      itemsConsidered: items.length, tradeExcluded: excluded.length,
      min: opts.min, max: opts.max, groupCount: groups.length,
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
