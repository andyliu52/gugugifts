#!/usr/bin/env node
// Post the next gugugifts blog post to the Google Business Profile.
//
// Picks one post per invocation, alternating between "newest unposted" and
// "oldest unposted" so the GBP feed mixes fresh content with backlog drain.
// Run twice a week to hit the 2-posts-per-week target.
//
// Usage:
//   node scripts/post-to-google-business.mjs                 # post next per alternation
//   node scripts/post-to-google-business.mjs --dry-run       # show payload, no API call
//   node scripts/post-to-google-business.mjs --side=newest   # force newest this run
//   node scripts/post-to-google-business.mjs --side=oldest   # force oldest this run
//   node scripts/post-to-google-business.mjs --slug=foo-bar  # post a specific slug
//
// Credentials at scripts/.google-business-credentials.json:
//   { "clientId": "...", "clientSecret": "...", "refreshToken": "...",
//     "accountId": "1234567890", "locationId": "1234567890" }
// State at scripts/.google-business-state.json (auto-created).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const CREDS_PATH = path.join(__dirname, '.google-business-credentials.json');
const STATE_PATH = path.join(__dirname, '.google-business-state.json');

const SITE = 'https://www.gugugifts.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const POSTS_API = 'https://mybusiness.googleapis.com/v4';

function args() {
  const a = process.argv.slice(2);
  const out = { dryRun: false, side: null, slug: null };
  for (const arg of a) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--side=')) out.side = arg.slice(7);
    else if (arg.startsWith('--slug=')) out.slug = arg.slice(7);
    else { console.error(`Unknown arg: ${arg}`); process.exit(2); }
  }
  if (out.side && out.side !== 'newest' && out.side !== 'oldest') {
    console.error(`--side must be "newest" or "oldest"`);
    process.exit(2);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('No frontmatter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, body: m[2] };
}

function strip(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/^['"]|['"]$/g, '');
}

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error(`Missing credentials file: ${CREDS_PATH}`);
    console.error(`Expected JSON: { clientId, clientSecret, refreshToken, accountId, locationId }`);
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  for (const k of ['clientId', 'clientSecret', 'refreshToken', 'accountId', 'locationId']) {
    if (!c[k]) { console.error(`Missing field in credentials: ${k}`); process.exit(1); }
  }
  return c;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { posted: [], nextSide: 'newest' };
  }
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!Array.isArray(s.posted)) s.posted = [];
  if (s.nextSide !== 'oldest' && s.nextSide !== 'newest') s.nextSide = 'newest';
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function loadPosts() {
  const now = new Date();
  const posts = [];
  for (const f of fs.readdirSync(BLOG_DIR)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.replace(/\.md$/, '');
    const text = fs.readFileSync(path.join(BLOG_DIR, f), 'utf8');
    const { fm } = parseFrontmatter(text);
    const draft = strip(fm.draft);
    if (draft === 'true') continue;
    const dateStr = strip(fm.date);
    if (!dateStr) continue;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) continue;
    if (date > now) continue;
    posts.push({
      slug,
      title: strip(fm.title) || slug,
      description: strip(fm.description) || '',
      heroImage: strip(fm.heroImage) || null,
      date,
    });
  }
  posts.sort((a, b) => b.date - a.date); // newest first
  return posts;
}

function pickPost(posts, postedSlugs, side, forceSlug) {
  if (forceSlug) {
    const p = posts.find(p => p.slug === forceSlug);
    if (!p) throw new Error(`No published post matches slug: ${forceSlug}`);
    return p;
  }
  const remaining = posts.filter(p => !postedSlugs.has(p.slug));
  if (remaining.length === 0) return null;
  return side === 'oldest' ? remaining[remaining.length - 1] : remaining[0];
}

async function refreshAccessToken(creds) {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`No access_token in response: ${text}`);
  return json.access_token;
}

function buildPayload(post) {
  const blogUrl = `${SITE}/blog/${post.slug}`;
  const imageUrl = post.heroImage ? `${SITE}${post.heroImage}` : null;
  const summary = post.description.slice(0, 1500);
  const payload = {
    languageCode: 'en-US',
    summary,
    callToAction: {
      actionType: 'LEARN_MORE',
      url: blogUrl,
    },
    topicType: 'STANDARD',
  };
  if (imageUrl) {
    payload.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }];
  }
  return payload;
}

async function createLocalPost(creds, accessToken, payload) {
  const url = `${POSTS_API}/accounts/${creds.accountId}/locations/${creds.locationId}/localPosts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`createLocalPost ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const opts = args();
  const state = loadState();
  const postedSlugs = new Set(state.posted.map(p => p.slug));
  const posts = loadPosts();
  const side = opts.side || state.nextSide;
  const post = pickPost(posts, postedSlugs, side, opts.slug);

  if (!post) {
    console.log(`No remaining posts to publish (${state.posted.length} already posted, ${posts.length} total).`);
    process.exit(0);
  }

  const payload = buildPayload(post);
  console.log(`SIDE   ${opts.slug ? `manual (--slug=${opts.slug})` : side}`);
  console.log(`SLUG   ${post.slug}`);
  console.log(`DATE   ${post.date.toISOString().slice(0, 10)}`);
  console.log(`TITLE  ${post.title}`);
  console.log(`URL    ${payload.callToAction.url}`);
  console.log(`IMAGE  ${payload.media ? payload.media[0].sourceUrl : '(none)'}`);
  console.log(`SUMMARY (${payload.summary.length} chars):`);
  console.log(`  ${payload.summary}`);

  if (opts.dryRun) {
    console.log(`\n[dry-run] Not calling API. Payload:`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const creds = loadCreds();
  console.log(`\nRefreshing access token...`);
  const accessToken = await refreshAccessToken(creds);
  console.log(`Posting to GBP localPosts...`);
  const result = await createLocalPost(creds, accessToken, payload);
  console.log(`OK     ${result.name || '(no name returned)'}`);

  state.posted.push({
    slug: post.slug,
    postedAt: new Date().toISOString(),
    side: opts.slug ? 'manual' : side,
    gbpPostName: result.name || null,
  });
  // Only flip the alternation when running on the default cadence.
  if (!opts.slug && !opts.side) {
    state.nextSide = side === 'newest' ? 'oldest' : 'newest';
  }
  saveState(state);
  console.log(`State updated. ${state.posted.length} posted total. Next side: ${state.nextSide}`);
}

main().catch(e => { console.error(`\nERROR: ${e.message}`); process.exit(1); });
