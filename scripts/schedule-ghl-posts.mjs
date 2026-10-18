#!/usr/bin/env node
// Schedule social posts to Facebook / Instagram / Google Business Profile via
// the GoHighLevel Social Planner API.
//
// Replaces the CSV-import path entirely: no byte-exact headers, no 40-column
// positional format, no 90-row cap, no manual upload step.
//
// SAFETY: this is a live, outward-facing action. It dry-runs by default and
// only creates posts when given --commit. Posts already created are recorded
// in social/.ghl-posted.json and skipped, because GHL does not de-duplicate —
// running twice without the guard would double-post everything.
//
// Usage:
//   node scripts/schedule-ghl-posts.mjs                    # dry run (default)
//   node scripts/schedule-ghl-posts.mjs --commit           # actually schedule
//   node scripts/schedule-ghl-posts.mjs --only=<postId>
//   node scripts/schedule-ghl-posts.mjs --platforms=facebook,instagram
//   node scripts/schedule-ghl-posts.mjs --validate         # checks only, no network
//
// Reads:  social/posts.json, social/catalog-snapshot.json
// Writes: social/.ghl-posted.json (state)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCreds, createPost, scheduleIso, describeSchedule, mask } from './lib/ghl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS = path.join(ROOT, 'social', 'posts.json');
const SNAPSHOT = path.join(ROOT, 'social', 'catalog-snapshot.json');
const STATE = path.join(ROOT, 'social', '.ghl-posted.json');

// Platform caption ceilings. The reference implementation enforced none, and
// post-to-google-business.mjs silently truncates at 1500 — mid-sentence
// truncation in marketing copy is worse than a build failure.
const LIMITS = { facebook: 63206, instagram: 2200, google: 1500, tiktok: 2200 };

// A post's images: `images` (a carousel) or the single `image`.
const imagesOf = p => p.images || (p.image ? [p.image] : []);

// TikTok gets the hashtags; the other channels get the plain caption.
const captionFor = (p, pl) => pl === 'google' ? (p.gbpCaption || p.caption)
  : pl === 'tiktok' && p.hashtags?.length ? `${p.caption}\n\n${p.hashtags.map(h => `#${h}`).join(' ')}`
  : p.caption;

const VALID_ACTION_TYPES = new Set([
  'none', 'order', 'book', 'shop', 'learn_more', 'call', 'sign_up',
]);

function args() {
  const out = { commit: false, only: null, platforms: null, validate: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--commit') out.commit = true;
    else if (a === '--validate') out.validate = true;
    else if (a.startsWith('--only=')) out.only = a.slice(7);
    else if (a.startsWith('--platforms=')) out.platforms = a.slice(12).split(',').map(s => s.trim());
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

function loadState() {
  if (!fs.existsSync(STATE)) return { posted: {} };
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  s.posted ||= {};
  return s;
}

const saveState = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');

// Validate everything up front and report ALL problems at once, rather than
// failing on the first one 20 posts into a live run.
function validate(doc, snapshot, accounts) {
  const errs = [];
  const warns = [];
  const seen = new Set();
  const inStock = new Set((snapshot?.items || []).map(i => i.id));

  if (!Array.isArray(doc.posts) || !doc.posts.length) errs.push('posts.json has no posts');

  for (const p of doc.posts || []) {
    const at = `post "${p.id || '(no id)'}"`;
    if (!p.id) errs.push(`${at}: missing id`);
    if (seen.has(p.id)) errs.push(`${at}: duplicate id`);
    seen.add(p.id);

    if (!p.caption || !p.caption.trim()) errs.push(`${at}: empty caption`);
    if (!p.date) errs.push(`${at}: missing date`);
    else if (Number.isNaN(Date.parse(p.date))) errs.push(`${at}: unparseable date "${p.date}"`);

    const platforms = p.platforms || doc.defaults?.platforms || [];
    if (!platforms.length) errs.push(`${at}: no platforms`);
    for (const pl of platforms) {
      if (!accounts[pl]) errs.push(`${at}: no connected account for platform "${pl}"`);
      const cap = captionFor(p, pl);
      const limit = LIMITS[pl];
      if (limit && cap && cap.length > limit) {
        errs.push(`${at}: ${pl} caption is ${cap.length} chars, limit ${limit}`);
      }
    }

    const imgs = imagesOf(p);
    if (!imgs.length || imgs.some(i => !i?.url)) errs.push(`${at}: no image url`);
    if (imgs.length > 10) errs.push(`${at}: ${imgs.length} images; Instagram carousels cap at 10`);
    if (platforms.includes('tiktok') && !p.video?.url) {
      errs.push(`${at}: TikTok needs a video; run scripts/build-tiktok-videos.mjs --upload`);
    }

    const cta = p.cta || doc.defaults?.cta;
    if (cta) {
      if (!VALID_ACTION_TYPES.has(cta.actionType)) errs.push(`${at}: bad cta.actionType "${cta.actionType}"`);
      if (cta.actionType !== 'none' && !/^https:\/\//.test(cta.actionUrl || '')) {
        errs.push(`${at}: cta.actionUrl must be https`);
      }
    }

    if (p.offer) {
      for (const f of ['title', 'offerTitle', 'startDate', 'endDate']) {
        if (!p.offer[f]) errs.push(`${at}: offer missing ${f} (GBP rejects offers without a validity window)`);
      }
    }

    // Stock drift: a post authored in August can go live in December after
    // the items have sold. Warn on partial, error only when nothing survives.
    if (Array.isArray(p.itemIds) && p.itemIds.length && inStock.size) {
      const live = p.itemIds.filter(id => inStock.has(id));
      if (live.length === 0) errs.push(`${at}: none of its ${p.itemIds.length} items are in stock`);
      else if (live.length < p.itemIds.length) {
        warns.push(`${at}: ${p.itemIds.length - live.length}/${p.itemIds.length} items no longer in stock`);
      }
    }
  }
  return { errs, warns };
}

// One API call per post, with every target channel in accountIds — GHL then
// shows a single entry in the Social Planner with all three socials attached,
// so an edit or a reschedule is one action rather than three.
//
// Splitting into one call per platform is the *customization* path, for when a
// channel needs different copy. We only do that when a post sets gbpCaption,
// since Google then needs its own text.
function buildDto(p, doc, creds, platforms) {
  const accountIds = platforms.map(pl => creds.accounts[pl]);
  const time = p.time || doc.defaults?.time || '17:00:00';
  const scheduleDate = scheduleIso(p.date, time, creds.timezone);
  // Batches are either one channel or the combined FB/IG/GBP set, so the
  // caption of the first platform is the caption of the batch.
  const summary = captionFor(p, platforms[0]);

  // Google gets one image even from a carousel: whether GBP accepts several
  // through GHL is unverified, and run() gives it its own batch.
  const imgs = platforms.length === 1 && platforms[0] === 'google' ? imagesOf(p).slice(0, 1) : imagesOf(p);
  // TikTok rejects images through GHL ("TikTok needs a video to create a
  // post"); it gets the slideshow MP4 from scripts/build-tiktok-videos.mjs.
  const media = platforms.length === 1 && platforms[0] === 'tiktok'
    ? [{ url: p.video.url, type: 'video/mp4' }]
    : imgs.map(i => ({ url: i.url, type: 'image/jpeg' }));

  const dto = {
    accountIds,
    summary,
    // MIME type, not a word. "image", "IMAGE" and "photo" are all rejected
    // with "Invalid media format type"; only image/jpeg and image/jpg pass.
    // Note draft posts accept anything here — the validation only runs for
    // status: 'scheduled', so a draft round-trip does NOT prove the shape.
    media,
    status: 'scheduled',
    type: 'post',
    scheduleDate,
    userId: creds.userId,
  };
  if (p.tags?.length) dto.tags = p.tags;

  // UNVERIFIED until the first --only probe: the SDK types tiktokPostDetails
  // as `any`. privacyLevel follows TikTok's own Content Posting API values.
  // promoteYourBrand is TikTok's commercial-content disclosure, which applies
  // to a shop posting its own products.
  if (platforms.includes('tiktok')) {
    dto.tiktokPostDetails = {
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      enableComment: true,
      enableDuet: false,
      enableStitch: false,
      promoteYourBrand: true,
      promoteOtherBrand: false,
      ...doc.defaults?.tiktok,
    };
  }

  // Google Business Profile carries the CTA / offer. Facebook and Instagram
  // have no equivalent field and ignore it, so it is safe to send on a
  // combined post that includes Google.
  if (platforms.includes('google')) {
    const cta = p.cta || doc.defaults?.cta;
    // gmbEventType is uppercase STANDARD | EVENT | OFFER. A plain CTA post is
    // STANDARD — there is no "call_to_action" value, despite the CSV format's
    // eventType column using exactly that string.
    if (p.offer) {
      dto.gmbPostDetails = {
        gmbEventType: 'OFFER',
        title: p.offer.title,
        offerTitle: p.offer.offerTitle,
        startDate: p.offer.startDate,
        endDate: p.offer.endDate,
        termsConditions: p.offer.termsConditions || undefined,
        couponCode: p.offer.couponCode || undefined,
        redeemOnlineUrl: p.offer.redeemOnlineUrl || undefined,
      };
    } else if (cta && cta.actionType !== 'none') {
      dto.gmbPostDetails = {
        gmbEventType: 'STANDARD',
        actionType: cta.actionType,
        url: cta.actionUrl,
      };
    }
  }
  return dto;
}

async function main() {
  const opts = args();

  for (const [label, f] of [['posts.json', POSTS], ['catalog-snapshot.json', SNAPSHOT]]) {
    if (!fs.existsSync(f) && label === 'posts.json') {
      console.error(`Missing social/${label}`); process.exit(1);
    }
  }
  const doc = JSON.parse(fs.readFileSync(POSTS, 'utf8'));
  const snapshot = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) : null;
  const creds = loadCreds();
  const accounts = creds.accounts || {};

  console.log(`TOKEN     ${mask(creds.apiToken)}`);
  console.log(`LOCATION  ${creds.locationId}`);
  console.log(`TIMEZONE  ${creds.timezone}`);
  console.log(`MODE      ${opts.validate ? 'validate' : opts.commit ? 'COMMIT (live)' : 'dry run'}\n`);

  const { errs, warns } = validate(doc, snapshot, accounts);
  for (const w of warns) console.log(`warn  ${w}`);
  if (errs.length) {
    console.error(`\n${errs.length} validation error(s):`);
    for (const e of errs) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`Validation passed: ${doc.posts.length} post(s).`);
  if (opts.validate) return;

  const state = loadState();
  let scheduled = 0, skipped = 0, failed = 0;

  for (const p of doc.posts) {
    if (opts.only && p.id !== opts.only) continue;

    const platforms = (p.platforms || doc.defaults?.platforms || [])
      .filter(pl => !opts.platforms || opts.platforms.includes(pl));
    if (!platforms.length) continue;

    // One combined post unless a channel needs different content:
    //  - TikTok always goes alone. Its payload is unverified, and one bad
    //    account in accountIds must not take FB/IG/GBP down with it.
    //  - Google goes alone with a distinct gbpCaption, or for a carousel
    //    (it is sent the first image only).
    // Keys of already-posted batches never change, since a post that doesn't
    // use these fields batches exactly as before.
    const alone = new Set(platforms.filter(pl => pl === 'tiktok'
      || (pl === 'google' && (p.gbpCaption || imagesOf(p).length > 1))));
    const batches = [platforms.filter(pl => !alone.has(pl)), ...[...alone].map(pl => [pl])]
      .filter(b => b.length);

    for (const batch of batches) {
      const key = `${p.id}::${batch.join('+')}`;
      if (state.posted[key]) { skipped++; continue; }

      const dto = buildDto(p, doc, creds, batch);
      // A past scheduleDate would publish immediately (or fail), and adding a
      // channel to an old post must not back-post it.
      if (Date.parse(dto.scheduleDate) < Date.now()) {
        console.log(`PAST ${p.id.padEnd(30)} ${batch.join('+').padEnd(28)} ${dto.scheduleDate}, not scheduling`);
        skipped++;
        continue;
      }
      const when = describeSchedule(p.date, p.time || doc.defaults?.time || '17:00:00', creds.timezone);

      if (!opts.commit) {
        console.log(`DRY  ${p.id.padEnd(30)} ${batch.join('+').padEnd(28)} ${when}`);
        console.log(`     ${dto.summary.split('\n')[0].slice(0, 90)}`);
        if (dto.media.length > 1) console.log(`     carousel, ${dto.media.length} images`);
        if (dto.gmbPostDetails) console.log(`     CTA ${dto.gmbPostDetails.actionType} -> ${dto.gmbPostDetails.url || ''}`);
        scheduled++;
        continue;
      }

      try {
        const res = await createPost(creds, dto);
        const id = res?.results?.post?._id || res?.post?._id || res?._id || '(no id)';
        state.posted[key] = { ghlPostId: id, scheduleDate: dto.scheduleDate, platforms: batch, at: new Date().toISOString() };
        saveState(state);   // persist per post — a crash mid-run must not re-post
        console.log(`OK   ${p.id.padEnd(30)} ${batch.join('+').padEnd(28)} ${id}`);
        scheduled++;
      } catch (e) {
        console.error(`FAIL ${p.id} ${batch.join('+')}: ${e.message.slice(0, 200)}`);
        failed++;
      }
    }
  }

  console.log(`\n${opts.commit ? 'Scheduled' : 'Would schedule'} ${scheduled}, skipped ${skipped} already posted, failed ${failed}.`);
  if (!opts.commit) console.log('Re-run with --commit to actually schedule these.');
  if (failed) process.exit(1);
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
