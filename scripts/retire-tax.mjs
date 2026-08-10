#!/usr/bin/env node
// Retire a duplicate/unused CatalogTax: strip it from every item that carries
// it, and optionally delete the object itself.
//
// Why this exists: the account carries two 8.25% tax objects. "Local Sales
// Tax" is the live one; "TX Sales Tax" is a disabled duplicate that 294 items
// still reference. A dormant tax on an item is a landmine — enable it in the
// Dashboard by accident and those items start charging 8.25% twice, and any
// script that reasons about "the sales tax" has to special-case it forever.
//
// Usage:
//   node scripts/retire-tax.mjs --tax=<id>                   # dry run
//   node scripts/retire-tax.mjs --tax=<id> --commit          # strip from items
//   node scripts/retire-tax.mjs --tax=<id> --commit --delete-object
//   node scripts/retire-tax.mjs --tax=<id> --undo --commit   # put it back
//
// Needs a token with ITEMS_WRITE. Records every item it touched to
// social/retired-tax-<id>.json (committed) so --undo can put it back.
//
// Stripping from items is reversible. Deleting the object is NOT — it is a
// separate opt-in flag for that reason.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCreds, squarePost, fetchItems, shapeItem } from './lib/square.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BATCH = 500;

function args() {
  const out = { tax: null, commit: false, deleteObject: false, undo: false, force: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--commit') out.commit = true;
    else if (a === '--delete-object') out.deleteObject = true;
    else if (a === '--undo') out.undo = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--tax=')) out.tax = a.slice(6);
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  if (!out.tax) { console.error('Required: --tax=<catalogTaxId>'); process.exit(2); }
  return out;
}

const rel = p => path.relative(process.cwd(), p);
const statePath = taxId => path.join(ROOT, 'social', `retired-tax-${taxId}.json`);

async function fetchTaxes(creds) {
  const r = await squarePost(creds, '/v2/catalog/search', { object_types: ['TAX'], limit: 100 });
  return r.objects || [];
}

async function main() {
  const opts = args();
  const creds = loadCreds();
  const STATE = statePath(opts.tax);

  console.log(`ENV    ${creds.environment}`);
  console.log(`LOC    ${creds.locationId || '(none set)'}`);
  console.log(`TAX    ${opts.tax}${opts.commit ? '  --commit' : '  (dry run)'}`);

  const taxes = await fetchTaxes(creds);
  const target = taxes.find(t => t.id === opts.tax);

  // ---------------------------------------------------------------- undo
  if (opts.undo) {
    if (!fs.existsSync(STATE)) {
      console.error(`\nNo record at ${rel(STATE)} — nothing to undo.`);
      process.exit(1);
    }
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (!target) {
      console.error(`\nTax ${opts.tax} no longer exists in the catalog — it was deleted.`);
      console.error('Re-create it in the Square Dashboard first; a deleted tax cannot be');
      console.error('restored by id, and a new one would have a different id anyway.');
      process.exit(1);
    }
    console.log(`\nRe-attaching to ${state.itemIds.length} item(s) recorded ${state.retiredAt}`);
    if (!opts.commit) { console.log('\nDry run — nothing sent. Re-run with --commit.'); return; }
    for (let i = 0; i < state.itemIds.length; i += BATCH) {
      const chunk = state.itemIds.slice(i, i + BATCH);
      await squarePost(creds, '/v2/catalog/update-item-taxes', {
        item_ids: chunk, taxes_to_enable: [opts.tax],
      });
      console.log(`   restored ${Math.min(i + chunk.length, state.itemIds.length)}/${state.itemIds.length}`);
    }
    fs.renameSync(STATE, `${STATE}.undone`);
    console.log('\nDone.');
    return;
  }

  // -------------------------------------------------------------- safety
  if (!target) {
    console.error(`\nNo TAX object with id ${opts.tax}. Found:`);
    for (const t of taxes) console.log(`   ${t.id}  ${t.tax_data?.percentage}%  ${t.tax_data?.name}`);
    process.exit(1);
  }

  const d = target.tax_data || {};
  console.log(`\nTarget: ${d.name} — ${d.percentage}% — ${d.enabled ? 'ENABLED' : 'disabled'}`);
  console.log(`Other taxes on the account:`);
  for (const t of taxes.filter(t => t.id !== opts.tax)) {
    console.log(`   ${t.id}  ${t.tax_data?.percentage}%  ${t.tax_data?.enabled ? 'ENABLED ' : 'disabled'}  ${t.tax_data?.name}`);
  }

  // Retiring the tax the shop actually collects would stop tax collection
  // entirely. That is never what this script is for.
  if (d.enabled && !opts.force) {
    console.error('\n! This tax is ENABLED — it is very likely the one being collected.');
    console.error('  Retiring it would stop tax collection. Pass --force if you are sure.');
    process.exit(1);
  }
  // The live tax carries applies_to_product_set_id (the Dashboard's record of
  // "apply to all items"). A dormant duplicate does not.
  if (d.applies_to_product_set_id && !opts.force) {
    console.error(`\n! This tax has applies_to_product_set_id=${d.applies_to_product_set_id},`);
    console.error('  which marks it as a configured, applied-to-all tax. Pass --force if sure.');
    process.exit(1);
  }

  // ------------------------------------------------------------ the work
  const { items, related } = await fetchItems(creds, null);
  const shaped = items.map(o => shapeItem(o, related, creds.locationId)).filter(i => !i.isArchived);
  const carrying = shaped.filter(i => i.taxIds.includes(opts.tax));
  const soleTax = carrying.filter(i => i.taxIds.length === 1);

  console.log(`\n${carrying.length} of ${shaped.length} item(s) carry this tax.`);
  if (soleTax.length) {
    console.error(`\n! ${soleTax.length} item(s) have this as their ONLY tax. Removing it`);
    console.error('  would make them untaxed. Listing the first 20:');
    for (const i of soleTax.slice(0, 20)) console.error(`   ${(i.price || '-').padEnd(10)} ${i.name.slice(0, 60)}`);
    if (!opts.force) { console.error('\n  Refusing. Pass --force to proceed anyway.'); process.exit(1); }
  }
  for (const i of carrying.slice(0, 10)) {
    console.log(`   ${(i.price || '-').padEnd(10)} ${i.name.slice(0, 52).padEnd(52)} -> keeps [${i.taxIds.filter(t => t !== opts.tax).join(', ') || 'NOTHING'}]`);
  }
  if (carrying.length > 10) console.log(`   ... and ${carrying.length - 10} more`);

  if (opts.deleteObject) {
    console.log(`\nWill ALSO delete the tax object itself. This is irreversible —`);
    console.log(`a re-created tax gets a new id, so --undo will not work afterwards.`);
  }

  if (!opts.commit) {
    console.log('\nDry run — nothing sent. Re-run with --commit.');
    return;
  }

  // WRITE-ONCE on itemIds. A second run — e.g. to add --delete-object after
  // the strip already succeeded — sees 0 items carrying the tax, and blindly
  // writing that would replace the undo record with an empty list. Union with
  // whatever is already recorded instead.
  const prior = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  const state = {
    retiredAt: prior?.retiredAt || new Date().toISOString(),
    tax: { id: target.id, name: d.name, percentage: d.percentage, enabled: d.enabled },
    itemIds: [...new Set([...(prior?.itemIds || []), ...carrying.map(i => i.id)])],
    objectDeleted: prior?.objectDeleted || false,
  };
  // Record before acting: update-item-taxes is idempotent, so a lost 5xx that
  // actually succeeded must not leave us without the list to undo from.
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

  for (let i = 0; i < carrying.length; i += BATCH) {
    const chunk = carrying.slice(i, i + BATCH);
    await squarePost(creds, '/v2/catalog/update-item-taxes', {
      item_ids: chunk.map(x => x.id),
      taxes_to_disable: [opts.tax],
    });
    console.log(`   stripped ${Math.min(i + chunk.length, carrying.length)}/${carrying.length}`);
  }

  if (opts.deleteObject) {
    await squarePost(creds, '/v2/catalog/batch-delete', { object_ids: [opts.tax] });
    state.objectDeleted = true;
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
    console.log(`   deleted tax object ${opts.tax}`);
  }

  // The response carries no per-item result, so re-read before claiming success.
  console.log('\nVerifying against a fresh read...');
  const after = await fetchItems(creds, null);
  const stillCarrying = after.items.filter(o => (o.item_data?.tax_ids || []).includes(opts.tax));
  const taxesAfter = await fetchTaxes(creds);
  console.log(`   items still carrying it: ${stillCarrying.length}`);
  console.log(`   tax objects on account:  ${taxesAfter.length}`);
  for (const t of taxesAfter) {
    console.log(`     ${t.id}  ${t.tax_data?.percentage}%  ${t.tax_data?.enabled ? 'ENABLED ' : 'disabled'}  ${t.tax_data?.name}`);
  }

  if (stillCarrying.length) {
    console.error(`\n! ${stillCarrying.length} item(s) still carry the tax. Re-run with --commit.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. Record kept at ${rel(STATE)} — commit it.`);
  console.log('Re-run `npm run tax:plan` so the holiday manifest reflects one tax.');
}

main().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
