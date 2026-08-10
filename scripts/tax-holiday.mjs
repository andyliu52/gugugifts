#!/usr/bin/env node
// Texas Sales Tax Holiday — turn the sales tax off for qualifying items, and
// put it back exactly as it was afterwards.
//
// Aug 7-9 2026: Texas retailers must NOT collect state or local sales tax
// (8.25% here) on clothing, footwear, student backpacks and a closed list of
// school supplies priced under $100. Square keeps charging until the catalog
// says otherwise, so this is a compliance job with a deadline, not a promo.
//
// Four modes, all dry-run by default except the read-only ones:
//
//   --plan      classify the live catalog, write the manifest        (no writes)
//   --status    is the exemption currently on?                       (no writes)
//   --apply     swap in a tax scoped to the non-exempt items    (needs --commit)
//   --restore   swap the original tax back                      (needs --commit)
//
// Usage:
//   node scripts/tax-holiday.mjs --plan
//   node scripts/tax-holiday.mjs --status
//   node scripts/tax-holiday.mjs --apply                  # dry run
//   node scripts/tax-holiday.mjs --apply --commit
//   node scripts/tax-holiday.mjs --restore --commit
//
// Manifest: social/tax-holiday-2026.json  (committed — this IS the reusable
//           group; edit `include` on ambiguous items and re-run --plan)
// State:    social/tax-holiday-state.json  (committed — records which tax was
//           swapped out, which was swapped in, and over which items)
//
// MECHANISM, and the two dead ends that led here.
//
// `Local Sales Tax` carries applies_to_product_set_id pointing at a product
// set with all_products: true. That binding is what makes the obvious routes
// impossible:
//
//   1. update-item-taxes to drop the tax from each exempt item:
//        "FEE objects passed in the taxes_to_disable field must not have an
//         associated PRODUCT_SET"
//      You cannot detach a product-set-bound tax from an individual item.
//
//   2. Repoint the tax at a narrower product set listing only the items that
//      should stay taxed:
//        "Product set (...) found on tax ... is invalid."
//      applies_to_product_set_id will not accept a product_ids_any set. It
//      appears to only tolerate all_products.
//
// What works is to leave the original tax alone and SWAP it out. A newly
// created tax has no product set, so per-item assignment is allowed:
//
//   1. create a second tax at the same rate, disabled, no product set
//   2. attach it to the ~1,807 items that should still be taxed
//   3. disable the original, then enable the new one
//
// Step 3's ordering matters. Disable-then-enable leaves a sub-second gap where
// NOTHING is taxed; enable-then-disable would leave a gap where everything is
// taxed TWICE. Under-collecting for a moment beats overcharging a customer.
//
// Restore reverses it and deletes the temporary tax. Note that a bare
// "disable the sales tax and add a 0% one" — the usual advice online — does
// not work for a gift shop: taxes are ADDITIVE, so a 0% tax alongside an 8.25%
// one still charges 8.25%, and disabling the original stops collection on the
// ~94% of the catalog that does NOT qualify for the holiday.
//
// The failure mode to respect: if the taxed-item list is short by an item,
// that item silently stops being taxed. Hence the count assertions before the
// write and the re-read after it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCreds, squarePost, fetchItems, shapeItem, SQUARE_VERSION,
} from './lib/square.mjs';
import { isTrade } from './lib/catalog-filters.mjs';
import { classify, priceCheck, isTradeExtra } from './lib/tax-holiday-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'social', 'tax-holiday-2026.json');
// Committed, not gitignored — same reasoning as social/.ghl-posted.json. This
// is the ONLY record of what each item's taxes were before we stripped them.
// Lose it over a weekend and the exemption cannot be reversed exactly.
const STATE = path.join(ROOT, 'social', 'tax-holiday-state.json');

const HOLIDAY = {
  name: 'Texas Sales Tax Holiday 2026',
  start: '2026-08-07',
  end: '2026-08-09',
};

function args() {
  const out = { mode: null, commit: false, force: false, showDenied: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--plan' || a === '--status' || a === '--apply' || a === '--restore') {
      if (out.mode) { console.error(`Pick one mode, got --${out.mode} and ${a}`); process.exit(2); }
      out.mode = a.slice(2);
    } else if (a === '--commit') out.commit = true;
    else if (a === '--force') out.force = true;
    else if (a === '--show-denied') out.showDenied = true;
    else if (a.startsWith('--only=')) {
      // Refuse rather than ignore. --only used to shrink the blast radius to a
      // single item; the tax is now repointed in one write, so honouring the
      // flag silently would apply to the whole catalog when the operator asked
      // for one SKU.
      console.error('--only is no longer supported: the exemption is one write on the');
      console.error('tax object, not per-item, so there is no smaller unit to probe.');
      console.error('Use --apply without --commit to see exactly what would change.');
      process.exit(2);
    } else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  out.mode = out.mode || 'plan';
  return out;
}

const readJson = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const rel = p => path.relative(process.cwd(), p);

// ---------------------------------------------------------------- live reads

async function fetchTaxes(creds) {
  const r = await squarePost(creds, '/v2/catalog/search', {
    object_types: ['TAX'], limit: 100,
  });
  return (r.objects || []).map(o => ({
    id: o.id,
    name: o.tax_data?.name || '(unnamed)',
    percentage: o.tax_data?.percentage || null,
    enabled: o.tax_data?.enabled === true,
  }));
}

async function fetchCatalog(creds) {
  const { items, related } = await fetchItems(creds, null);
  return items
    .map(o => shapeItem(o, related, creds.locationId))
    .filter(i => !i.isArchived && i.presentAtLocation);
}

// ------------------------------------------------------------------ classify

function buildManifest(catalog, taxes, previous) {
  // Carry forward any human decision already made on an ambiguous item.
  // Without this, re-running --plan silently discards the review.
  const priorInclude = new Map(
    (previous?.items || []).map(i => [i.id, i.include]),
  );

  const rows = [];
  const straddlers = [];
  let tradeSkipped = 0;

  for (const item of catalog) {
    if (isTrade(item.name) || isTradeExtra(item.name)) { tradeSkipped++; continue; }

    const verdict = classify(item);
    if (verdict.verdict === 'skip') continue;

    const price = priceCheck(item);
    if (price.straddles) straddlers.push({ item, price });

    // Over $100 is not exempt regardless of what it is.
    const overThreshold = !price.ok;
    let bucket = verdict.verdict;
    if (overThreshold && bucket !== 'denied') bucket = 'over-threshold';

    const carried = priorInclude.get(item.id);
    rows.push({
      id: item.id,
      name: item.name,
      category: item.categories[0] || null,
      price: item.price,
      priceCents: item.priceCents,
      verdict: bucket,
      rule: verdict.rule,
      overruled: verdict.overruled || null,
      reason: overThreshold ? price.reason : null,
      taxIds: item.taxIds,
      // Qualifying items are in. Everything else is out unless a human said
      // otherwise in a previous pass.
      include: carried !== undefined ? carried : bucket === 'qualify',
    });
  }

  rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name));

  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      holiday: HOLIDAY,
      squareVersion: SQUARE_VERSION,
      catalogSize: catalog.length,
      tradeSkipped,
      counts,
      includedCount: rows.filter(r => r.include).length,
      straddleCount: straddlers.length,
    },
    taxes,
    items: rows,
  };
}

function printReview(manifest, opts) {
  const by = v => manifest.items.filter(i => i.verdict === v);
  const line = i =>
    `   ${(i.price || '-').padEnd(11)} ${(i.category || '-').slice(0, 16).padEnd(16)} ` +
    `${i.name.slice(0, 52).padEnd(52)} [${i.rule}]`;

  const qualify = by('qualify');
  console.log(`\nQUALIFY — tax comes OFF these ${qualify.length} items`);
  const byRule = new Map();
  for (const i of qualify) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i);
  }
  for (const [rule, group] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${rule} (${group.length})`);
    for (const i of group) console.log(line(i));
  }

  const amb = by('ambiguous');
  if (amb.length) {
    console.log(`\n\nAMBIGUOUS — your call. Default is EXCLUDED (tax stays on).`);
    console.log(`  To exempt one, set "include": true on it in ${rel(MANIFEST)}`);
    console.log(`  and re-run --plan. Your edits are preserved across runs.\n`);
    for (const i of amb) console.log(`${i.include ? ' ✓' : ' ·'}${line(i).slice(1)}`);
  }

  const over = by('over-threshold');
  if (over.length) {
    console.log(`\n\nOVER $100 — would qualify but the price disqualifies it (${over.length})`);
    for (const i of over) console.log(`${line(i)}  ${i.reason}`);
  }

  const denied = by('denied');
  if (denied.length) {
    console.log(`\n\nEXCLUDED — matched "${denied[0].overruled}"-style wording but ruled out (${denied.length})`);
    if (opts.showDenied) {
      for (const i of denied) console.log(`${line(i)} overruled ${i.overruled}`);
    } else {
      const tally = new Map();
      for (const i of denied) tally.set(i.rule, (tally.get(i.rule) || 0) + 1);
      for (const [rule, n] of [...tally].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(n).padStart(4)}  ${rule}`);
      }
      console.log('   (--show-denied to list them — worth doing once)');
    }
  }
}

// --------------------------------------------------------------------- modes

async function modePlan(creds, opts) {
  const [taxes, catalog] = [await fetchTaxes(creds), await fetchCatalog(creds)];
  const previous = readJson(MANIFEST);
  const manifest = buildManifest(catalog, taxes, previous);

  console.log('\nTaxes on this account:');
  for (const t of taxes) {
    console.log(`   ${t.id}  ${t.percentage}%  ${t.enabled ? 'ENABLED ' : 'disabled'}  ${t.name}`);
  }

  printReview(manifest, opts);

  if (manifest.meta.straddleCount) {
    console.warn(`\n! ${manifest.meta.straddleCount} item(s) have variations on both sides of $100.`);
    console.warn('  update-item-taxes is item-level, so these cannot be split.');
    console.warn('  They are marked over-threshold (tax stays on). Handle at the register.');
  }

  // If the tax is not actually attached per-item — a location-level default,
  // or "apply to all items" — then update-item-taxes has nothing to remove and
  // will report a cheerful 200 while the register keeps charging all weekend.
  const taxIds = new Set(taxes.map(t => t.id));
  const wanted = manifest.items.filter(i => i.include);
  const carrying = wanted.filter(i => i.taxIds.some(t => taxIds.has(t))).length;
  if (wanted.length && carrying / wanted.length < 0.9) {
    console.error(`\n! Only ${carrying}/${wanted.length} items to exempt actually carry one of`);
    console.error('  these tax objects. That means the tax is applied somewhere other');
    console.error('  than the item — a location default, or applies-to-all — and');
    console.error('  update-item-taxes will silently do nothing. Stop and check the');
    console.error('  Square Dashboard tax settings before applying.');
    process.exit(1);
  }

  writeJson(MANIFEST, manifest);
  console.log(`\n${manifest.meta.includedCount} item(s) marked for exemption.`);
  console.log(`Wrote ${rel(MANIFEST)}`);
  console.log('\nNext: review the list above, then  npm run tax:apply');
}

function included(manifest) {
  const rows = manifest.items.filter(i => i.include);
  if (!rows.length) {
    console.error('\nNo items marked include=true in the manifest. Run --plan first.');
    process.exit(1);
  }
  return rows;
}

// Disabling the wrong tax would stop collection shop-wide, so refuse to guess
// when the account does not have exactly one enabled tax.
function liveTax(manifest) {
  const enabled = manifest.taxes.filter(t => t.enabled);
  if (enabled.length !== 1) {
    console.error(`\nExpected exactly one enabled tax, found ${enabled.length}:`);
    for (const t of manifest.taxes) {
      console.error(`   ${t.id}  ${t.percentage}%  ${t.enabled ? 'ENABLED' : 'disabled'}  ${t.name}`);
    }
    process.exit(1);
  }
  return enabled[0];
}

async function fetchObject(creds, id) {
  const r = await squarePost(creds, '/v2/catalog/batch-retrieve', { object_ids: [id] });
  return (r.objects || [])[0] || null;
}

const idem = label => `tax-holiday-${label}-${Date.now()}`;

// Flip a tax on or off. Upserting a TAX needs its current `version`, so always
// re-read immediately before writing.
async function setTaxEnabled(creds, taxId, enabled) {
  const fresh = await fetchObject(creds, taxId);
  if (!fresh) throw new Error(`Tax ${taxId} not found`);
  await squarePost(creds, '/v2/catalog/object', {
    idempotency_key: idem(enabled ? 'enable' : 'disable'),
    object: { ...fresh, tax_data: { ...fresh.tax_data, enabled } },
  });
}

async function setItemTaxes(creds, itemIds, { enable, disable }, label) {
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500);
    const body = { item_ids: chunk };
    if (enable) body.taxes_to_enable = [enable];
    if (disable) body.taxes_to_disable = [disable];
    await squarePost(creds, '/v2/catalog/update-item-taxes', body);
    console.log(`   ${label} ${Math.min(i + chunk.length, itemIds.length)}/${itemIds.length}`);
  }
}

async function reportTaxes(creds, prefix = '') {
  const r = await squarePost(creds, '/v2/catalog/search', { object_types: ['TAX'], limit: 100 });
  for (const o of r.objects || []) {
    const d = o.tax_data;
    console.log(`${prefix}${o.id}  ${d.percentage}%  ${d.enabled ? 'ENABLED ' : 'disabled'}  ${d.name}` +
      `${d.applies_to_product_set_id ? '  [product set]' : ''}`);
  }
  return r.objects || [];
}

async function modeApply(creds, opts) {
  const manifest = readJson(MANIFEST);
  if (!manifest) { console.error(`No manifest at ${rel(MANIFEST)}. Run --plan first.`); process.exit(1); }

  const rows = included(manifest);
  const original = liveTax(manifest);
  const exempt = new Set(rows.map(r => r.id));

  const catalog = await fetchCatalog(creds);
  const taxed = catalog.filter(i => !exempt.has(i.id));
  const missing = rows.filter(r => !catalog.some(i => i.id === r.id));

  console.log(`\nOriginal tax:  ${original.name} ${original.percentage}%  (${original.id})`);
  console.log(`Catalog:       ${catalog.length} item(s) at this location`);
  console.log(`Exempt:        ${exempt.size}${missing.length ? ` (${missing.length} no longer in the catalog)` : ''}`);
  console.log(`Stay taxed:    ${taxed.length}`);

  // A SHORT taxed list silently stops taxing whatever fell off it. Assert the
  // arithmetic before writing anything.
  const expected = catalog.length - (exempt.size - missing.length);
  if (taxed.length !== expected) {
    console.error(`\n! Arithmetic does not check out: ${taxed.length} taxed vs ${expected} expected. Refusing.`);
    process.exit(1);
  }
  if (!taxed.length) { console.error('\n! That would leave NOTHING taxed. Refusing.'); process.exit(1); }

  const existing = readJson(STATE);
  if (existing && !opts.force) {
    console.error(`\n${rel(STATE)} already records an exemption applied ${existing.appliedAt}.`);
    console.error('Run --restore first, or pass --force.');
    process.exit(1);
  }

  console.log(`\nPlan:`);
  console.log(`  1. create a new ${original.percentage}% tax, DISABLED, with no product set`);
  console.log(`  2. attach it to the ${taxed.length} non-exempt item(s)  (no effect while disabled)`);
  console.log(`  3. disable ${original.name}, then enable the new one`);
  console.log(`\n  Step 3 is ordered disable-then-enable on purpose: the gap between`);
  console.log(`  the two writes is a moment of NO tax rather than DOUBLE tax.`);

  if (!opts.commit) {
    console.log('\nDry run — nothing sent. Re-run with --commit.');
    return;
  }

  // 1. New tax, created disabled and WITHOUT applies_to_product_set_id. That
  //    omission is the whole point: Square refuses update-item-taxes against a
  //    tax that has a product set, which is why the original cannot be scoped.
  const created = await squarePost(creds, '/v2/catalog/object', {
    idempotency_key: idem('newtax'),
    object: {
      type: 'TAX',
      id: '#holidayTax',
      present_at_all_locations: true,
      tax_data: {
        name: `Sales Tax (holiday scope)`,
        calculation_phase: 'TAX_SUBTOTAL_PHASE',
        inclusion_type: 'ADDITIVE',
        percentage: original.percentage,
        applies_to_custom_amounts: true,
        enabled: false,
      },
    },
  });
  const newTaxId = created.catalog_object.id;
  console.log(`\nCreated ${newTaxId} — ${original.percentage}%, disabled, no product set.`);

  // Record before any switch-over, so a lost response cannot orphan the state.
  writeJson(STATE, {
    appliedAt: new Date().toISOString(),
    holiday: HOLIDAY,
    originalTaxId: original.id,
    originalTaxName: original.name,
    holidayTaxId: newTaxId,
    exemptCount: exempt.size,
    taxedCount: taxed.length,
    taxedItemIds: taxed.map(i => i.id),
    exemptItemIds: [...exempt],
  });

  await setItemTaxes(creds, taxed.map(i => i.id), { enable: newTaxId }, 'attached');

  await setTaxEnabled(creds, original.id, false);
  console.log(`Disabled ${original.name}.`);
  await setTaxEnabled(creds, newTaxId, true);
  console.log(`Enabled the holiday tax.`);

  console.log('\nVerifying against a fresh read...');
  await modeStatus(creds);
  console.log('\n! The API confirms configuration, not what the register charges.');
  console.log('  Ring a test sale on one exempt item and one non-exempt item now.');
  console.log('\nRestore Monday Aug 10:  npm run tax:restore -- --commit');
}

async function modeRestore(creds, opts) {
  const state = readJson(STATE);
  if (!state) {
    console.error(`\nNothing to restore — ${rel(STATE)} is missing.`);
    console.error('If the holiday tax is live and this file is gone, re-enable the');
    console.error('original tax and disable the holiday one in the Square Dashboard.');
    process.exit(1);
  }

  console.log(`\nApplied ${state.appliedAt}`);
  console.log(`Re-enable:  ${state.originalTaxName} (${state.originalTaxId})`);
  console.log(`Disable:    holiday tax (${state.holidayTaxId})`);
  console.log(`Then strip the holiday tax from ${state.taxedItemIds.length} item(s) and delete it.`);
  console.log('\nCurrent taxes:');
  await reportTaxes(creds, '   ');

  if (!opts.commit) {
    console.log('\nDry run — nothing sent. Re-run with --commit.');
    return;
  }

  // Same ordering rule as apply: disable first, so the gap is no-tax rather
  // than double-tax.
  await setTaxEnabled(creds, state.holidayTaxId, false);
  console.log('\nDisabled the holiday tax.');
  await setTaxEnabled(creds, state.originalTaxId, true);
  console.log(`Re-enabled ${state.originalTaxName}.`);

  await setItemTaxes(creds, state.taxedItemIds, { disable: state.holidayTaxId }, 'detached');
  await squarePost(creds, '/v2/catalog/batch-delete', { object_ids: [state.holidayTaxId] });
  console.log(`Deleted the holiday tax object.`);

  fs.renameSync(STATE, `${STATE}.restored`);
  console.log('\nVerifying against a fresh read...');
  await modeStatus(creds);
}

async function modeStatus(creds) {
  const manifest = readJson(MANIFEST);
  if (!manifest) { console.error(`No manifest at ${rel(MANIFEST)}. Run --plan first.`); process.exit(1); }
  const state = readJson(STATE);

  console.log('\nTaxes on the account:');
  const taxes = await reportTaxes(creds, '   ');
  const enabled = taxes.filter(t => t.tax_data.enabled);

  if (enabled.length !== 1) {
    console.error(`\n! ${enabled.length} taxes are enabled. Exactly one should be.`);
    if (enabled.length > 1) console.error('  Customers are being charged twice. Fix this now.');
    else console.error('  Nothing is being taxed at all. Fix this now.');
    process.exitCode = 1;
    return;
  }

  if (!state) {
    console.log('\nExemption: OFF — no holiday tax recorded, original tax is live.');
    return;
  }

  const live = enabled[0];
  const catalog = await fetchCatalog(creds);
  const byId = new Map(catalog.map(i => [i.id, i]));
  const wanted = manifest.items.filter(i => i.include);

  const stillTaxed = wanted.filter(i => byId.get(i.id)?.taxIds.includes(live.id));
  const taxedOk = state.taxedItemIds.filter(id => byId.get(id)?.taxIds.includes(live.id));

  console.log(`\nLive tax: ${live.tax_data.name} (${live.id})`);
  console.log(`   should-be-exempt items carrying it: ${stillTaxed.length} of ${wanted.length}`);
  console.log(`   should-be-taxed items carrying it:  ${taxedOk.length} of ${state.taxedItemIds.length}`);

  if (stillTaxed.length) {
    console.warn(`\n! ${stillTaxed.length} item(s) that should be exempt are still taxed:`);
    for (const i of stillTaxed.slice(0, 10)) console.warn(`   ${i.name.slice(0, 55)}`);
    process.exitCode = 1;
  }
  if (taxedOk.length !== state.taxedItemIds.length) {
    console.warn(`\n! ${state.taxedItemIds.length - taxedOk.length} item(s) that SHOULD be taxed are not.`);
    console.warn('  That is under-collection — the shop eats it. Fix before trading.');
    process.exitCode = 1;
  }
  if (!stillTaxed.length && taxedOk.length === state.taxedItemIds.length) {
    console.log('\nExemption: ON — qualifying items untaxed, everything else taxed.');
  }
}

// ---------------------------------------------------------------------- main

async function main() {
  const opts = args();
  const creds = loadCreds();

  console.log(`ENV    ${creds.environment}`);
  console.log(`LOC    ${creds.locationId || '(none set)'}`);
  console.log(`MODE   ${opts.mode}${opts.commit ? ' --commit' : ''}${opts.only ? ` --only=${opts.only}` : ''}`);

  if (opts.mode === 'plan') return modePlan(creds, opts);
  if (opts.mode === 'status') return modeStatus(creds);
  if (opts.mode === 'apply') return modeApply(creds, opts);
  if (opts.mode === 'restore') return modeRestore(creds, opts);
}

main().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
