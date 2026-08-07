#!/usr/bin/env node
// Build blog hero images from real Square product photography.
//
// Preferred over generate-comfyui-images.mjs for product posts: a real photo
// of the actual item beats a generated scene of a generic gift shop, and it
// needs no GPU. Falls back to a real shop photo from src/assets/gallery/.
//
// Two things this has to handle that a naive downloader does not:
//
//   1. Not every Square image URL is usable. Some return a tiny placeholder
//      PNG (one LUDDITE item returns 113x53), so every download is validated
//      against MIN_EDGE and the next candidate is tried on failure.
//   2. Product photos are square, shot on white. Cover-cropping one to 16:9
//      slices the product in half. These are composited with `contain` onto
//      a white canvas instead, so the whole object survives. Gallery photos
//      are real scenes and DO get cover-cropped.
//
// Usage:
//   node scripts/build-blog-heroes.mjs                 # build any missing hero
//   node scripts/build-blog-heroes.mjs --force         # rebuild all
//   node scripts/build-blog-heroes.mjs --slug=<slug>
//   node scripts/build-blog-heroes.mjs --dry-run
//
// Reads:  social/groups.json, src/assets/gallery/
// Writes: public/images/blog/<slug>.jpg

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GROUPS = path.join(ROOT, 'social', 'groups.json');
const GALLERY = path.join(ROOT, 'src', 'assets', 'gallery');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'blog');

const WIDTH = 1280;
const HEIGHT = 720;
const MIN_EDGE = 500;          // reject placeholder/broken images
const CANVAS = { r: 255, g: 255, b: 255 }; // product shots are on white — a tinted
                                            // canvas leaves a visible seam box
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) gugugifts-scripts/1.0';

// Which group each post draws its hero from. Candidates are tried in order,
// so a broken image or an empty group falls through rather than failing.
const HEROES = {
  'japanese-stationery-terrell-stamps-ink-pens': {
    groups: ['LUDDITE', 'OSCOLABO', 'SANBY'],
    gallery: '03-greeting-cards.jpg',
  },
  'everyday-jewelry-under-35-terrell-rain-splendid-iris': {
    groups: ['Rain Jewelry — Earrings', 'Splendid Iris — Earrings'],
    gallery: '02-jewelry-wall.jpg',
  },
  'good-jewelry-case-julie-vos-brenda-grands-terrell': {
    groups: ['Julie Vos', 'Brenda Grands'],
    gallery: '02-jewelry-wall.jpg',
  },
  'ty-plush-terrell-small-gifts-under-16': {
    groups: ['Ty'],
    gallery: '08-plush-toys.jpg',
  },
  // Cardthartic has no product photography, and the "Other gifts" long tail
  // surfaces whatever happens to sort first (a hand cream), which is
  // off-theme for a post about cards and sachets. Go straight to the shop photo.
  'under-15-gifts-terrell-cards-sachets-small-things': {
    groups: ['Cardthartic'],
    gallery: '06-gift-bags.jpg',
  },
};

function args() {
  const out = { force: false, slug: null, dryRun: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice(7);
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('undecodable');
  if (Math.min(meta.width, meta.height) < MIN_EDGE) {
    throw new Error(`too small (${meta.width}x${meta.height}) — placeholder`);
  }
  return { buf, meta };
}

// Square product shot -> 16:9 hero. `contain` on a white field, because the
// product is centred on white and a cover crop would cut it in half.
async function composeProduct(buf) {
  return sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: CANVAS },
  })
    .composite([{
      input: await sharp(buf)
        .resize(HEIGHT - 60, HEIGHT - 60, { fit: 'inside', withoutEnlargement: false })
        .toBuffer(),
      gravity: 'centre',
    }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

// Real shop photo -> 16:9. These are scenes, so cover-crop is right.
async function composeScene(buf) {
  return sharp(buf)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

async function main() {
  const opts = args();

  if (!fs.existsSync(GROUPS)) {
    console.error(`Missing ${path.relative(process.cwd(), GROUPS)} — run: npm run social:group`);
    process.exit(1);
  }
  const { groups } = JSON.parse(fs.readFileSync(GROUPS, 'utf8'));
  const byLabel = new Map(groups.map(g => [g.label, g]));

  const slugs = opts.slug ? [opts.slug] : Object.keys(HEROES);
  let built = 0, skipped = 0, failed = 0;

  for (const slug of slugs) {
    const spec = HEROES[slug];
    if (!spec) { console.error(`No hero spec for slug: ${slug}`); failed++; continue; }

    const dest = path.join(OUT_DIR, `${slug}.jpg`);
    if (fs.existsSync(dest) && !opts.force) {
      console.log(`SKIP  ${slug} (exists — use --force)`);
      skipped++;
      continue;
    }

    // Try each group's featured items in turn.
    let out = null, note = '';
    for (const label of spec.groups) {
      const g = byLabel.get(label);
      if (!g) { console.log(`      no group "${label}"`); continue; }
      for (const f of g.featured || []) {
        if (!f.imageUrl) continue;
        try {
          const { buf, meta } = await fetchImage(f.imageUrl);
          if (opts.dryRun) { note = `${label} / ${f.name} (${meta.width}x${meta.height})`; out = 'DRY'; break; }
          out = await composeProduct(buf);
          note = `${label} / ${f.name} (${meta.width}x${meta.height})`;
          break;
        } catch (e) {
          console.log(`      reject ${f.name.slice(0, 40)}: ${e.message}`);
        }
      }
      if (out) break;
    }

    // Fall back to a real photograph of the shop.
    if (!out && spec.gallery) {
      const gp = path.join(GALLERY, spec.gallery);
      if (fs.existsSync(gp)) {
        if (opts.dryRun) { out = 'DRY'; note = `gallery/${spec.gallery}`; }
        else { out = await composeScene(fs.readFileSync(gp)); note = `gallery/${spec.gallery}`; }
      }
    }

    if (!out) { console.error(`FAIL  ${slug} — no usable source`); failed++; continue; }
    if (opts.dryRun) { console.log(`DRY   ${slug}  <- ${note}`); continue; }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(dest, out);
    console.log(`OK    ${slug}.jpg  ${(out.length / 1024).toFixed(0)} KB  <- ${note}`);
    built++;
  }

  console.log(`\nDone. built=${built} skipped=${skipped} failed=${failed}`);
  if (failed) process.exit(1);
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
