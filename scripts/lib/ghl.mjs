// GoHighLevel client: Social Planner + Media Storage.
//
// Schema recovered from the official SDK (@gohighlevel/api-client@3.0.0,
// dist/lib/code/social-media-posting/models/social-media-posting.d.ts) rather
// than the docs site, whose request schemas render client-side and are not in
// the HTML.
//
// Credentials at scripts/.ghl-credentials.json:
//   { "apiToken": "pit-...", "locationId": "...", "userId": "...",
//     "mediaFolderId": "optional", "timezone": "America/Chicago" }
//
// Token: a Private Integration Token for the Gugu Gifts SUB-ACCOUNT.
// Scopes needed: socialplanner/post.write, socialplanner/account.readonly,
// medias.readonly, medias.write.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(__dirname, '..');
export const CREDS_PATH = path.join(SCRIPTS_DIR, '.ghl-credentials.json');

const API_BASE = 'https://services.leadconnectorhq.com';

// Two different API versions live on the same host. The Social Planner
// endpoints are v3; Media Storage is still on the dated scheme. Sending the
// wrong one gets you a confusing 422 rather than a clear error.
const VERSION_SOCIAL = 'v3';
const VERSION_MEDIA = '2021-07-28';

// Cloudflare 1010-bans unrecognised clients, and undici's default UA is
// literally "node". txfitness hit this with urllib and had to set a browser
// UA on every request; the same applies here.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) gugugifts-social/1.0';

export function mask(s) {
  if (!s) return '(unset)';
  return s.length <= 8 ? '***' : `${s.slice(0, 3)}...${s.slice(-3)}`;
}

export function loadCreds() {
  const fromEnv = process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID;
  let c;
  if (fs.existsSync(CREDS_PATH)) {
    c = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  } else if (fromEnv) {
    c = {};
  } else {
    console.error(`Missing credentials file: ${CREDS_PATH}`);
    console.error(`Expected JSON: { apiToken, locationId, userId, timezone }`);
    console.error(`Create a Private Integration Token for the Gugu Gifts sub-account with`);
    console.error(`scopes: socialplanner/post.write, socialplanner/account.readonly,`);
    console.error(`        medias.readonly, medias.write`);
    process.exit(1);
  }
  c.apiToken = process.env.GHL_API_TOKEN || c.apiToken;
  c.locationId = process.env.GHL_LOCATION_ID || c.locationId;
  c.timezone = c.timezone || 'America/Chicago';

  if (!c.apiToken) { console.error('Missing field in credentials: apiToken'); process.exit(1); }
  if (!c.locationId) { console.error('Missing field in credentials: locationId'); process.exit(1); }

  // The template ships with FILL_IN_ placeholders. Catch them here — sending
  // one to the API returns a bare 401 that reads like a scope problem.
  const unfilled = Object.entries(c)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('FILL_IN_'))
    .map(([k]) => k);
  if (unfilled.length) {
    console.error(`Credentials not filled in yet: ${unfilled.join(', ')}`);
    console.error(`Edit ${CREDS_PATH} — the _readme in that file says where each value comes from.`);
    process.exit(1);
  }
  return c;
}

// `idempotent` decides what may be retried.
//
// A 504/524 means the gateway gave up waiting — the request may well have
// SUCCEEDED server-side with the response lost in transit. Retrying a POST
// /posts on that creates a second scheduled post. This actually happened: a
// 524 on the Aug 21 post produced two identical entries, one of which the
// state file did not know about.
//
// So for non-idempotent calls, only 429 (definitively not processed) is
// retried. Timeouts and 5xx surface to the caller, which then reports a
// failure the operator can check rather than silently double-posting.
async function withRetry(fn, label, { idempotent = true } = {}) {
  const backoff = [1000, 4000, 10000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = /\b429\b/.test(err.message);
      const is5xx = /\b5\d\d\b/.test(err.message);
      const retryable = is429 || (idempotent && is5xx);
      if (!retryable || attempt >= backoff.length) {
        if (is5xx && !idempotent) {
          console.warn(`  ${label} timed out. NOT retrying — the request may have`);
          console.warn(`  succeeded server-side. Verify before re-running.`);
        }
        throw err;
      }
      const wait = backoff[attempt];
      console.warn(`  ${label} failed (${err.message.slice(0, 70)}...), retrying in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function ghlFetch(creds, apiPath, { method = 'GET', body, version = VERSION_SOCIAL, raw, idempotent } = {}) {
  // Default: anything that isn't a plain read is treated as unsafe to retry.
  const safe = idempotent ?? (method === 'GET');
  return withRetry(async () => {
    const headers = {
      'Authorization': `Bearer ${creds.apiToken}`,
      'Version': version,
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    };
    const init = { method, headers };
    if (raw) {
      init.body = raw; // FormData — never set Content-Type, fetch adds the boundary
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${apiPath}`, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${apiPath} ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  }, `${method} ${apiPath}`, { idempotent: safe });
}

/* ---------------------------------------------------------------- accounts */

// GET /social-media-posting/{locationId}/accounts
// Returns { accounts: GetAccountSchema[], groups: GetGroupSchema[] }
// GetAccountSchema = { id, oauthId, profileId, name, platform, type, expire, isExpired, meta }
export async function listAccounts(creds) {
  const json = await ghlFetch(creds, `/social-media-posting/${creds.locationId}/accounts`);
  const results = json.results || json;
  return {
    accounts: results.accounts || [],
    groups: results.groups || [],
    raw: json,
  };
}

// Platform strings as GHL reports them. Verified against a live account by
// scripts/ghl-accounts.mjs — run that before trusting any mapping here.
export const PLATFORM = {
  facebook: 'facebook',
  instagram: 'instagram',
  google: 'google',
};

export function pickAccounts(accounts, platforms) {
  const wanted = new Set(platforms);
  const picked = accounts.filter(a => wanted.has(String(a.platform).toLowerCase()));
  const expired = picked.filter(a => a.isExpired);
  return { picked, expired };
}

/* ------------------------------------------------------------------- posts */

// POST /social-media-posting/{locationId}/posts
//
// CreatePostDTO (from the SDK):
//   accountIds: string[]        required
//   type: string                required — post status/kind
//   userId: string              required
//   summary?: string            the caption
//   media?: PostMediaSchema[]   { url, caption?, type?, thumbnail?, id? }
//   scheduleDate?: string
//   followUpComment?: string
//   tags?: string[]
//   categoryId?: string
//   gmbPostDetails?: GMBPostSchema
//   tiktokPostDetails?: TiktokPostSchema
//
// GMBPostSchema:
//   { gmbEventType, title, offerTitle, startDate, endDate,
//     termsConditions, url, couponCode, redeemOnlineUrl, actionType }
export async function createPost(creds, dto) {
  return ghlFetch(creds, `/social-media-posting/${creds.locationId}/posts`, {
    method: 'POST',
    body: dto,
  });
}

export async function deletePost(creds, postId) {
  return ghlFetch(creds, `/social-media-posting/${creds.locationId}/posts/${postId}`, {
    method: 'DELETE',
  });
}

// POST /social-media-posting/{locationId}/posts/list — search existing posts.
// Used to detect posts we already created, as a backstop to the local state
// file (a state file lost to a fresh clone must not cause double-posting).
export async function listPosts(creds, { fromDate, toDate, limit = 100, skip = 0 } = {}) {
  return ghlFetch(creds, `/social-media-posting/${creds.locationId}/posts/list`, {
    method: 'POST',
    body: { fromDate, toDate, limit: String(limit), skip: String(skip), includeUsers: 'false' },
    idempotent: true, // a POST, but a pure read — safe to retry
  });
}

/* ------------------------------------------------------------------- media */

async function scanMediaFiles(creds) {
  const out = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({
      altType: 'location', altId: creds.locationId, type: 'file',
      limit: '100', offset: String(offset), sortBy: 'createdAt', sortOrder: 'desc',
    });
    const json = await ghlFetch(creds, `/medias/files?${qs}`, { version: VERSION_MEDIA });
    const files = json.files || json.data || [];
    out.push(...files);
    if (files.length < 100) break;
    offset += files.length;
  }
  return out;
}

function urlOf(file) {
  if (typeof file.url === 'string') return file.url;
  // Fall back to any https value so a schema change fails loudly downstream
  // rather than silently producing rows with no image.
  for (const v of Object.values(file)) {
    if (typeof v === 'string' && v.startsWith('https://')) return v;
  }
  return null;
}

// basename -> hosted URL. Newest-first scan plus first-wins means a re-upload
// under the same name resolves to the newest copy.
export async function fetchMediaMap(creds) {
  const files = await scanMediaFiles(creds);
  const map = new Map();
  for (const f of files) {
    const name = f.name || f.filename;
    const url = urlOf(f);
    if (!name || !url) continue;
    if (!map.has(name)) map.set(name, url);
  }
  if (map.size === 0) {
    throw new Error(
      'Media library returned nothing usable. Check the token has medias.readonly ' +
      'and that locationId is the Gugu Gifts sub-account.'
    );
  }
  return map;
}

export async function uploadFile(creds, filePath, basename) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('name', basename);
  form.append('hosted', 'false');
  if (creds.mediaFolderId) form.append('parentId', creds.mediaFolderId);
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), basename);

  const json = await ghlFetch(creds, '/medias/upload-file', {
    method: 'POST', version: VERSION_MEDIA, raw: form,
  });
  const url = json.url || urlOf(json);
  if (!url) throw new Error(`Upload of ${basename} returned no url: ${JSON.stringify(json).slice(0, 300)}`);
  return url;
}

/* ---------------------------------------------------------------- schedule */

// Offset of `timeZone` from UTC at a given instant, in milliseconds.
function tzOffsetMs(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(ts)).filter(x => x.type !== 'literal').map(x => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUtc - ts;
}

// Convert a wall-clock date+time in `timeZone` to a real UTC instant.
//
// This matters more than it looks: a fall campaign crosses the DST boundary
// (America/Chicago is UTC-5 through Nov 1 2026, UTC-6 after), so a hardcoded
// offset posts an hour off for part of the run. "5pm CST" colloquially means
// 5pm on the clock in Terrell, which is what this produces.
export function zonedToUtc(dateStr, timeStr, timeZone = 'America/Chicago') {
  const naive = Date.parse(`${dateStr}T${timeStr}Z`);
  if (Number.isNaN(naive)) throw new Error(`Unparseable date/time: ${dateStr} ${timeStr}`);
  let ts = naive;
  // Two passes settle the case where the first guess lands on the other side
  // of a transition.
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(ts, timeZone);
  return new Date(ts);
}

export function scheduleIso(dateStr, timeStr, timeZone) {
  return zonedToUtc(dateStr, timeStr, timeZone).toISOString();
}

// Human-readable confirmation line, so a run prints what an operator can
// actually check against a calendar.
export function describeSchedule(dateStr, timeStr, timeZone = 'America/Chicago') {
  const d = zonedToUtc(dateStr, timeStr, timeZone);
  // dateStyle/timeStyle cannot be combined with component options such as
  // timeZoneName — Intl throws "Invalid option". Spell the components out.
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
  return `${local}  (${d.toISOString()})`;
}
