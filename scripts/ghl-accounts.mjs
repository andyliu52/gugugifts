#!/usr/bin/env node
// Read-only probe of the GoHighLevel Social Planner for this sub-account.
//
// Run this FIRST, before anything tries to schedule a post. It confirms the
// token works, the scopes are right, and which Facebook / Instagram / Google
// Business Profile accounts are actually connected — their `id` values are
// what CreatePostDTO.accountIds needs, and they cannot be guessed.
//
// It writes nothing and creates nothing.
//
// Usage:
//   node scripts/ghl-accounts.mjs
//   node scripts/ghl-accounts.mjs --json      # full raw response, for debugging

import { loadCreds, listAccounts, mask, describeSchedule } from './lib/ghl.mjs';

function args() {
  const out = { json: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--json') out.json = true;
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

async function main() {
  const opts = args();
  const creds = loadCreds();

  console.log(`TOKEN     ${mask(creds.apiToken)}`);
  console.log(`LOCATION  ${creds.locationId}`);
  console.log(`TIMEZONE  ${creds.timezone}`);
  console.log('');

  const { accounts, groups, raw } = await listAccounts(creds);

  if (opts.json) {
    console.log(JSON.stringify(raw, null, 2));
    return;
  }

  if (accounts.length === 0) {
    console.error('No social accounts connected to this sub-account.');
    console.error('Connect Facebook, Instagram and Google Business Profile in the');
    console.error('GHL UI under Marketing > Social Planner > Settings first.');
    process.exit(1);
  }

  console.log(`${accounts.length} connected account(s):\n`);
  const byPlatform = new Map();
  for (const a of accounts) {
    const p = String(a.platform || 'unknown').toLowerCase();
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p).push(a);
  }

  for (const [platform, list] of [...byPlatform].sort()) {
    console.log(`  ${platform}`);
    for (const a of list) {
      const flag = a.isExpired ? '  ** EXPIRED — reconnect in the GHL UI **' : '';
      console.log(`    ${a.id}   ${a.name || '(unnamed)'}${flag}`);
      if (a.type) console.log(`      type: ${a.type}`);
    }
    console.log('');
  }

  if (groups.length) {
    console.log(`${groups.length} group(s):`);
    for (const g of groups) console.log(`  ${g.id}  ${g.name}  (${g.accountIds.length} accounts)`);
    console.log('');
  }

  const expired = accounts.filter(a => a.isExpired);
  if (expired.length) {
    console.log(`! ${expired.length} account(s) have expired tokens and will fail to post.`);
    console.log('');
  }

  const want = ['facebook', 'instagram', 'google'];
  const missing = want.filter(p => !byPlatform.has(p));
  if (missing.length) {
    console.log(`! Not connected: ${missing.join(', ')}`);
    console.log('  Posts targeting these platforms cannot be scheduled.');
    console.log('');
  }

  console.log('Schedule sanity check — 5:00 PM local on either side of the DST change:');
  for (const d of ['2026-09-08', '2026-11-10']) {
    console.log(`  ${d}  ->  ${describeSchedule(d, '17:00:00', creds.timezone)}`);
  }
  console.log('');
  console.log('Copy the account ids above into scripts/.ghl-credentials.json as');
  console.log('  "accounts": { "facebook": "...", "instagram": "...", "google": "..." }');
}

main().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
