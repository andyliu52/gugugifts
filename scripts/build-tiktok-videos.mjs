#!/usr/bin/env node
// Build TikTok slideshow videos for social posts, and optionally upload them.
//
// GHL's TikTok channel rejects image posts outright ("TikTok needs a video to
// create a post"), so every TikTok post needs an MP4. Each one is the post's
// photos (the photos/manifest.json social sources) as a 9:16 slideshow with a
// slow push-in, crossfades between carousel slides, and a licensed track from
// the music folder trimmed, faded and loudness-normalised for TikTok.
//
// Usage:
//   node scripts/build-tiktok-videos.mjs                 # build any missing video
//   node scripts/build-tiktok-videos.mjs --force         # rebuild all
//   node scripts/build-tiktok-videos.mjs --only=<postId>
//   node scripts/build-tiktok-videos.mjs --upload        # upload to the GHL media
//                                                        # library, write video.url
//                                                        # into social/posts.json
//
// Reads:  photos/manifest.json (social, tiktokMusic, musicDir), social/posts.json
// Writes: ~/gugupics/oct-2026/tiktok/<postId>.mp4 (outside the repo — videos
//         are hosted in the GHL media library, not deployed with the site)
// Needs:  ffmpeg and ffprobe on PATH (or FFMPEG / FFPROBE env vars).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadCreds, uploadFile, fetchMediaMap } from './lib/ghl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'photos', 'manifest.json');
const POSTS = path.join(ROOT, 'social', 'posts.json');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

const W = 1080, H = 1920, FPS = 30;
const SINGLE_SECONDS = 8;     // one photo: long enough for the caption to be read
const SLIDE_SECONDS = 3.2;    // per carousel slide
const XFADE = 0.5;
const ZOOM_TO = 1.08;         // slow push-in over each slide

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const UPLOAD = argv.includes('--upload');
const ONLY = argv.find(a => a.startsWith('--only='))?.slice(7);

const expandHome = p => p.replace(/^~(?=\/)/, os.homedir());
const spec = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const doc = JSON.parse(fs.readFileSync(POSTS, 'utf8'));
const SRC = expandHome(spec.src);
const MUSIC = expandHome(spec.musicDir);
const OUT = expandHome(spec.tiktokOut);

const duration = f => parseFloat(execFileSync(FFPROBE,
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));

// Spread uses of the same track across it, so back-to-back posts with one mood
// don't open on the identical bar. Skips the first few seconds of intro.
const trackUses = {};
function musicStart(track, need) {
  const len = duration(path.join(MUSIC, `${track}.wav`));
  const n = trackUses[track] = (trackUses[track] ?? -1) + 1;
  const usable = Math.max(0, len - need - 4);
  return usable ? (4 + (n * 23) % usable) : 0;
}

async function frame(src, dest) {
  // A 3:4 phone photo cover-cropped to 9:16 loses a quarter of its width,
  // which cuts gift boxes off at the sides. Instead: the whole photo, centred
  // on a blurred, darkened copy of itself. 10% oversize leaves room for the
  // push-in.
  const fw = Math.round(W * 1.1), fh = Math.round(H * 1.1);
  const bg = await sharp(src).rotate().resize(fw, fh, { fit: 'cover' })
    .blur(40).modulate({ brightness: 0.7 }).toBuffer();
  const fg = await sharp(src).rotate().resize(fw, fh, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
  await sharp(bg)
    .composite([{ input: fg.data, left: Math.round((fw - fg.info.width) / 2), top: Math.round((fh - fg.info.height) / 2) }])
    .jpeg({ quality: 92 }).toFile(dest);
}

async function build(post) {
  const srcs = [].concat(spec.social[post.id]).map(s => path.join(SRC, s));
  const track = spec.tiktokMusic[post.id];
  if (!track) throw new Error(`${post.id}: no tiktokMusic entry in the manifest`);
  const per = srcs.length > 1 ? SLIDE_SECONDS : SINGLE_SECONDS;
  const total = srcs.length * per - (srcs.length - 1) * XFADE;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-'));
  const frames = [];
  for (const [i, s] of srcs.entries()) {
    const f = path.join(tmp, `${i}.jpg`);
    await frame(s, f);
    frames.push(f);
  }

  const n = Math.round(per * FPS);
  const inc = ((ZOOM_TO - 1) / n).toFixed(6);
  const filters = frames.map((_, i) =>
    `[${i}:v]zoompan=z='min(zoom+${inc},${ZOOM_TO})':d=${n}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
    `:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
  let last = 'v0';
  for (let i = 1; i < frames.length; i++) {
    const off = (i * per - i * XFADE).toFixed(3);
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${off}[x${i}]`);
    last = `x${i}`;
  }
  const a = frames.length;
  filters.push(`[${a}:a]afade=t=in:d=0.4,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,` +
    `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`);

  const dest = path.join(OUT, `${post.id}.mp4`);
  const start = musicStart(track, total);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    ...frames.flatMap(f => ['-i', f]),
    '-ss', start.toFixed(2), '-t', total.toFixed(2), '-i', path.join(MUSIC, `${track}.wav`),
    '-filter_complex', filters.join(';'),
    '-map', `[${last}]`, '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-t', total.toFixed(2), '-movflags', '+faststart', dest,
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = fs.statSync(dest).size / 1024 / 1024;
  console.log(`  ${post.id.padEnd(36)} ${String(srcs.length).padStart(2)} photo(s)  ${total.toFixed(1)}s  ${track} @${start.toFixed(0)}s  ${mb.toFixed(1)} MB`);
  return dest;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const posts = doc.posts.filter(p => p.platforms?.includes('tiktok') && (!ONLY || p.id === ONLY));
  if (!posts.length) throw new Error('no TikTok posts matched');

  for (const p of posts) {
    const dest = path.join(OUT, `${p.id}.mp4`);
    if (FORCE || !fs.existsSync(dest)) await build(p);
  }
  console.log(`\n${posts.length} video(s) in ${OUT}`);
  if (!UPLOAD) return;

  // Upload once per name; a re-run reuses what's already in the library.
  const creds = loadCreds();
  const have = await fetchMediaMap(creds).catch(() => new Map());
  for (const p of posts) {
    const name = `tiktok-${p.id}.mp4`;
    const url = have.get(name) || await uploadFile(creds, path.join(OUT, `${p.id}.mp4`), name);
    p.video = { source: 'ghl', url };
    console.log(`  uploaded ${name}`);
  }
  fs.writeFileSync(POSTS, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote video urls for ${posts.length} post(s) to social/posts.json`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
