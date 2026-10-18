#!/usr/bin/env node
// Route triaged real shop photos (staging JPEGs) into the site at the right size
// per destination. Reuses the sharp settings established by resize-photos.mjs
// (rotate → resize → mozjpeg → strip EXIF) and generate-comfyui-images.mjs
// (blog heroes: 1280×720 cover, q86).
//
//   node scripts/place-shop-photos.mjs           # process all
//   node scripts/place-shop-photos.mjs --dry     # print plan only
//
// Source staging dir: ~/gugupics/jpg (produced by heic-to-jpeg.mjs).

import { mkdir, stat, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import sharp from 'sharp';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = process.env.SRC || join(homedir(), 'gugupics', 'jpg');
const DRY = process.argv.includes('--dry');

// Output presets.
const P = {
  hero: { w: 2200, q: 82 },
  category: { w: 900, q: 82 },
  gallery: { w: 1400, q: 80 },
  about: { w: 1400, q: 82 },
  blog: { w: 1280, h: 720, q: 86, cover: true },
  og: { w: 1200, h: 630, q: 84, cover: true },
};

// src stem (IMG_xxxx) → list of destinations.
// dest paths are relative to project root.
const MAP = [
  // ---- Homepage hero slideshow (added alongside existing front/power-wall/shelves) ----
  ['IMG_5691', P.hero, 'src/assets/hero/counter-tablescape.jpg'],
  ['IMG_5699', P.hero, 'src/assets/hero/jewelry-cases.jpg'],
  ['IMG_5700', P.hero, 'src/assets/hero/tabletop-collection.jpg'],

  // ---- Category tiles (3 refreshed + 3 new so all 6 have photos) ----
  ['IMG_5695', P.category, 'src/assets/categories/home-fragrance.jpg'],
  ['IMG_5693', P.category, 'src/assets/categories/necklaces.jpg'],
  ['IMG_5710', P.category, 'src/assets/categories/stationary.jpg'],
  ['IMG_5703', P.category, 'src/assets/categories/home-decor.jpg'],
  ['IMG_5704', P.category, 'src/assets/categories/local-honey.jpg'],
  ['IMG_5698', P.category, 'src/assets/categories/bags-and-cards.jpg'],

  // ---- "Inside the Shop" gallery ----
  ['IMG_5696', P.gallery, 'src/assets/gallery/01-inside-the-shop.jpg'],
  ['IMG_5692', P.gallery, 'src/assets/gallery/02-jewelry-wall.jpg'],
  ['IMG_5716', P.gallery, 'src/assets/gallery/03-greeting-cards.jpg'],
  ['IMG_5701', P.gallery, 'src/assets/gallery/04-entertaining.jpg'],
  ['IMG_5717', P.gallery, 'src/assets/gallery/05-swig-drinkware.jpg'],
  ['IMG_5715', P.gallery, 'src/assets/gallery/06-gift-bags.jpg'],
  ['IMG_5713', P.gallery, 'src/assets/gallery/07-bath-and-body.jpg'],
  ['IMG_5714', P.gallery, 'src/assets/gallery/08-plush-toys.jpg'],
  ['IMG_5702', P.gallery, 'src/assets/gallery/09-whimsical-gifts.jpg'],

  // ---- Social share image ----
  ['IMG_5691', P.og, 'public/og-image.jpg'],

  // ---- Real heroes onto existing blog posts (overwrite; frontmatter path unchanged) ----
  ['IMG_5693', P.blog, 'public/images/blog/julie-vos-jewelry-why-texans-choose-it.jpg'],
  ['IMG_5695', P.blog, 'public/images/blog/voluspa-scent-guide-choosing-the-right-candle.jpg'],
  ['IMG_5691', P.blog, 'public/images/blog/the-art-of-gift-giving-our-favorite-brands.jpg'],
  ['IMG_5714', P.blog, 'public/images/blog/walking-shops-at-terrell-with-kids.jpg'],
  ['IMG_5719', P.blog, 'public/images/blog/teacher-appreciation-gifts-kaufman-county-under-30.jpg'],
  ['IMG_5704', P.blog, 'public/images/blog/local-honey-and-artisan-goods-supporting-texas-makers.jpg'],
  ['IMG_5696', P.blog, 'public/images/blog/visiting-the-shops-at-terrell-gift-shop-guide.jpg'],

  // ---- Heroes for NEW blog posts ----
  ['IMG_5711', P.blog, 'public/images/blog/inside-gugu-gifts-terrell-photo-tour.jpg'],
  ['IMG_5710', P.blog, 'public/images/blog/stationery-corner-gugu-gifts-terrell.jpg'],
  ['IMG_5699', P.blog, 'public/images/blog/jewelry-at-gugu-gifts-julie-vos-rain-terrell.jpg'],
  ['IMG_5703', P.blog, 'public/images/blog/tablescaping-pampa-bay-splatterware-terrell.jpg'],
  ['IMG_5717', P.blog, 'public/images/blog/swig-drinkware-gugu-gifts-terrell.jpg'],
];

async function placeOne(stem, preset, relDest) {
  const srcPath = join(SRC, `${stem}.jpg`);
  const destPath = join(ROOT, relDest);
  if (DRY) {
    console.log(`  ${stem} → ${relDest}`);
    return 0;
  }
  await mkdir(dirname(destPath), { recursive: true });
  let img = sharp(srcPath).rotate();
  if (preset.cover) {
    img = img.resize(preset.w, preset.h, { fit: 'cover', position: 'attention' });
  } else {
    img = img.resize({ width: preset.w, withoutEnlargement: true });
  }
  await img
    .jpeg({ quality: preset.q, mozjpeg: true })
    .withMetadata({ exif: {} })
    .toFile(destPath);
  const { size } = await stat(destPath);
  console.log(`  ${stem} → ${relDest} (${(size / 1024).toFixed(0)} KB)`);
  return size;
}

// ---- Manifest mode -------------------------------------------------------
//
//   node scripts/place-shop-photos.mjs --manifest=photos/manifest.json [--dry] [--only=<key>]
//
// Driven by a JSON placement spec instead of MAP, for shoots too large to
// hand-route here. Product photos are phone portraits (3:4), so a single
// cover crop to 16:9 keeps only the middle 42% of the frame and slices most
// gift boxes in half. A hero with 2-3 sources is laid out side by side
// instead, each panel cover-cropped to a tall slot, which keeps the product.

const MANIFEST = process.argv.find((a) => a.startsWith('--manifest='))?.slice(11);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const CREAM = { r: 0xfa, g: 0xf7, b: 0xf2 };   // --color-cream
const GAP = 8;

const expandHome = (p) => p.replace(/^~(?=\/)/, homedir());

async function writeJpeg(img, destPath, q) {
  await mkdir(dirname(destPath), { recursive: true });
  await img.jpeg({ quality: q, mozjpeg: true }).withMetadata({ exif: {} }).toFile(destPath);
  return (await stat(destPath)).size;
}

async function buildHero(srcs, destPath) {
  const { w, h, q } = P.blog;
  if (srcs.length === 1) {
    return writeJpeg(sharp(srcs[0]).rotate().resize(w, h, { fit: 'cover', position: 'attention' }), destPath, q);
  }
  const panelW = Math.floor((w - GAP * (srcs.length - 1)) / srcs.length);
  const panels = await Promise.all(srcs.map((s) =>
    sharp(s).rotate().resize(panelW, h, { fit: 'cover', position: 'attention' }).toBuffer()));
  const canvas = sharp({ create: { width: w, height: h, channels: 3, background: CREAM } })
    .composite(panels.map((input, i) => ({ input, left: i * (panelW + GAP), top: 0 })));
  return writeJpeg(canvas, destPath, q);
}

async function runManifest() {
  const spec = JSON.parse(await readFile(join(ROOT, MANIFEST), 'utf8'));
  const base = expandHome(spec.src);
  const jobs = [
    ...Object.entries(spec.heroes || {}).map(([slug, srcs]) => ({
      key: slug, srcs, dest: `public/images/blog/${slug}.jpg`, kind: 'hero' })),
    ...Object.entries(spec.inline || {}).map(([key, src]) => ({
      key, srcs: [src], dest: `public/images/products/${key}.jpg`, kind: 'inline' })),
    // An array is a carousel: one 4:5 frame per slide, numbered in order.
    ...Object.entries(spec.social || {}).flatMap(([id, src]) => (Array.isArray(src)
      ? src.map((s, i) => ({ key: id, srcs: [s], dest: `public/images/social/${id}-${i + 1}.jpg`, kind: 'social' }))
      : [{ key: id, srcs: [src], dest: `public/images/social/${id}.jpg`, kind: 'social' }])),
  ].filter((j) => !ONLY || j.key === ONLY);

  // Fail before writing anything if a source is missing — a half-placed
  // shoot leaves heroes pointing at stale images.
  const missing = [];
  for (const j of jobs) for (const s of j.srcs) {
    try { await stat(join(base, s)); } catch { missing.push(`${j.key}: ${s}`); }
  }
  if (missing.length) throw new Error(`Missing sources:\n  ${missing.join('\n  ')}`);

  let total = 0;
  for (const j of jobs) {
    const srcs = j.srcs.map((s) => join(base, s));
    const destPath = join(ROOT, j.dest);
    if (DRY) { console.log(`  ${j.kind.padEnd(6)} ${j.dest}  <- ${j.srcs.join(' | ')}`); continue; }
    let size;
    if (j.kind === 'hero') size = await buildHero(srcs, destPath);
    else if (j.kind === 'social') {
      size = await writeJpeg(sharp(srcs[0]).rotate().resize(1080, 1350, { fit: 'cover', position: 'attention' }), destPath, 84);
    } else {
      size = await writeJpeg(sharp(srcs[0]).rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }), destPath, 80);
    }
    total += size;
    console.log(`  ${j.kind.padEnd(6)} ${j.dest} (${(size / 1024).toFixed(0)} KB)`);
  }
  console.log(`\n${jobs.length} outputs${DRY ? '' : `, ${(total / 1024 / 1024).toFixed(2)} MB total`}.`);
}

async function main() {
  if (MANIFEST) return runManifest();
  console.log(`Source: ${SRC}\n${DRY ? '[dry run]\n' : ''}`);
  let total = 0;
  for (const [stem, preset, dest] of MAP) {
    total += await placeOne(stem, preset, dest);
  }
  console.log(`\n${MAP.length} outputs${DRY ? '' : `, ${(total / 1024 / 1024).toFixed(2)} MB total`}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
