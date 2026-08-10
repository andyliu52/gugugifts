// Shared Square Catalog + Inventory helpers.
//
// Used by pull-square-new-items.mjs (what's been added since last run) and
// pull-square-catalog.mjs (full in-stock snapshot). Credentials live at
// scripts/.square-credentials.json — see README-square-workflow.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(__dirname, '..');
export const CREDS_PATH = path.join(SCRIPTS_DIR, '.square-credentials.json');

export const SQUARE_VERSION = '2026-07-15';

const HOSTS = {
  production: 'https://connect.squareup.com',
  sandbox: 'https://connect.squareupsandbox.com',
};

// Square rejects requests from clients it doesn't recognise far less often
// than GHL does, but keep a real UA for consistency across both clients.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) gugugifts-scripts/1.0';

export function loadCreds() {
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

// Retry 429s and 5xx. A full-catalog pull is many more requests than the
// new-items diff ever made, and Square throttles.
async function withRetry(fn, label) {
  const backoff = [1000, 4000, 10000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = /\b(429|5\d\d)\b/.test(err.message);
      if (!retryable || attempt >= backoff.length) throw err;
      const wait = backoff[attempt];
      console.warn(`  ${label} failed (${err.message.slice(0, 60)}...), retrying in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

export async function squarePost(creds, apiPath, body) {
  return withRetry(async () => {
    const res = await fetch(`${HOSTS[creds.environment]}${apiPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${apiPath} ${res.status}: ${text}`);
    return JSON.parse(text);
  }, apiPath);
}

// Page through POST /v2/catalog/search for ITEM objects, collecting related
// CATEGORY and IMAGE objects so we can resolve names and image URLs.
export async function fetchItems(creds, since) {
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
export function formatMoney(money) {
  if (!money || typeof money.amount !== 'number') return null;
  const value = money.amount / 100;
  const currency = money.currency || 'USD';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return value % 1 === 0 ? `${symbol}${value}` : `${symbol}${value.toFixed(2)}`;
}

export function priceRange(variations) {
  const amounts = variations
    .map(v => v.item_variation_data?.price_money)
    .filter(m => m && typeof m.amount === 'number');
  if (amounts.length === 0) return null;
  const sorted = [...amounts].sort((a, b) => a.amount - b.amount);
  const low = formatMoney(sorted[0]);
  const high = formatMoney(sorted[sorted.length - 1]);
  return low === high ? low : `${low}–${high}`;
}

function lowestPriceCents(variations) {
  const amounts = variations
    .map(v => v.item_variation_data?.price_money?.amount)
    .filter(a => typeof a === 'number');
  return amounts.length ? Math.min(...amounts) : null;
}

// `locationId` lets us tell whether an item is actually carried at Terrell.
// A catalog can contain items scoped to other locations; for a snapshot that
// feeds marketing copy, those must not be included.
function presentAtLocation(itemData, locationId) {
  if (!locationId) return true;
  if (itemData.present_at_all_locations === false) {
    const ids = itemData.present_at_location_ids || [];
    return ids.includes(locationId);
  }
  const absent = itemData.absent_at_location_ids || [];
  return !absent.includes(locationId);
}

export function shapeItem(obj, related, locationId) {
  const d = obj.item_data || {};
  const variations = d.variations || [];

  const categories = (d.categories || [])
    .map(c => related.get(c.id)?.category_data?.name)
    .filter(Boolean);

  // Keep the image ID paired with the URL. The ID is the stable join key —
  // a re-uploaded product photo mints a brand new CDN URL.
  const images = (d.image_ids || [])
    .map(id => {
      const url = related.get(id)?.image_data?.url;
      return url ? { id, url } : null;
    })
    .filter(Boolean);

  return {
    id: obj.id,
    name: d.name || '(unnamed)',
    description: (d.description_plaintext || d.description || '').trim() || null,
    categories,
    // Which CatalogTax objects apply. Needed by tax-holiday.mjs, which has to
    // record each item's own set before stripping it — they are not uniform.
    taxIds: d.tax_ids || [],
    price: priceRange(variations),
    priceCents: lowestPriceCents(variations),
    variations: variations.map(v => ({
      id: v.id,
      name: v.item_variation_data?.name || null,
      sku: v.item_variation_data?.sku || null,
      price: formatMoney(v.item_variation_data?.price_money),
      // Raw cents as well as the formatted string: the tax-holiday $100
      // threshold is a per-variation numeric test, and re-parsing "$8.95"
      // back out of the display string is how rounding bugs get in.
      priceCents: v.item_variation_data?.price_money?.amount ?? null,
      trackInventory: v.item_variation_data?.track_inventory ?? null,
    })),
    images,
    isArchived: d.is_archived === true,
    presentAtLocation: presentAtLocation(d, locationId),
    updatedAt: obj.updated_at || null,
  };
}

// Batch-retrieve on-hand counts. Returns a Map of variationId -> quantity.
// Only IN_STOCK counts are summed; SOLD/WASTE/etc. are other states of the
// same object and would double-count.
export async function fetchInventory(creds, variationIds) {
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

// Decide whether an item is sellable, and how confident we are about it.
//
// The subtlety that matters: Square only returns an inventory count for a
// variation with `track_inventory` enabled. A variation with tracking OFF
// returns NO count at all — indistinguishable from "counted, and it's zero"
// if you just read the map. A gift shop leaves tracking off for a large
// share of SKUs, so treating a missing count as zero silently deletes much
// of the shop from any snapshot built on it.
//
// Rule: tracked variations must have a positive count; untracked variations
// are assumed to be on the shelf.
export function applyStock(item, counts) {
  let trackedTotal = 0;
  let anyTracked = false;
  let sellable = false;

  for (const v of item.variations) {
    if (v.trackInventory === true) {
      anyTracked = true;
      const qty = counts.get(v.id) || 0;
      trackedTotal += qty;
      if (qty > 0) sellable = true;
    } else {
      sellable = true; // untracked ⇒ assume available
    }
  }

  item.stockKnown = anyTracked;
  item.stock = anyTracked ? trackedTotal : null;
  item.inStock = sellable;
  return item;
}

// Summarise a shaped+stocked item list the way a human needs to see it on
// run one — this line is how a mis-scoped token or a wrong locationId gets
// caught before anything downstream is built on bad data.
export function stockBreakdown(items) {
  const trackedInStock = items.filter(i => i.stockKnown && i.inStock).length;
  const untracked = items.filter(i => !i.stockKnown).length;
  const trackedZero = items.filter(i => i.stockKnown && !i.inStock).length;
  return {
    total: items.length,
    trackedInStock,
    untracked,
    trackedZero,
    inStock: items.filter(i => i.inStock).length,
    line: `${items.length} items · ${trackedInStock} tracked in stock · ${untracked} untracked (assumed available) · ${trackedZero} tracked-zero excluded`,
  };
}
