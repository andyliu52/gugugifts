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

import { mkdir, stat } from 'node:fs/promises';
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

async function main() {
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
