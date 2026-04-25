#!/usr/bin/env node
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import sharp from 'sharp';

const SOURCE_DIR = process.argv[2] || process.env.SOURCE_DIR || join(homedir(), 'gugu');
const PROJECT_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const HERO_DIR = join(PROJECT_ROOT, 'src/assets/hero');
const CATEGORIES_DIR = join(PROJECT_ROOT, 'src/assets/categories');

const MAX_WIDTH = 2400;
const QUALITY = 82;

// Map source filename (without extension, lowercased) → destination subdir.
// Anything not listed is skipped with a warning.
const ROUTING = {
  'front': 'hero',
  'power wall': 'hero',
  'shelves 1': 'hero',
  'shelves 2': 'hero',
  'necklaces': 'categories',
  'bags and cards': 'categories',
  'stationary': 'categories',
};

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function processFile(srcPath, destDir, slug) {
  await mkdir(destDir, { recursive: true });
  const destPath = join(destDir, `${slug}.jpg`);
  await sharp(srcPath)
    .rotate() // honor EXIF orientation before stripping
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .withMetadata({ exif: {} }) // strip EXIF
    .toFile(destPath);
  const { size } = await stat(destPath);
  return { destPath, size };
}

async function main() {
  console.log(`Source: ${SOURCE_DIR}`);
  const entries = await readdir(SOURCE_DIR);
  const photos = entries.filter((f) => {
    if (f.includes('Zone.Identifier')) return false;
    const ext = extname(f).toLowerCase();
    return ['.png', '.jpg', '.jpeg'].includes(ext);
  });

  let processed = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const file of photos) {
    const stem = basename(file, extname(file));
    const key = stem.toLowerCase();
    const route = ROUTING[key];
    if (!route) {
      console.warn(`  skip (no routing): ${file}`);
      skipped++;
      continue;
    }
    const destDir = route === 'hero' ? HERO_DIR : CATEGORIES_DIR;
    const slug = slugify(stem);
    const { destPath, size } = await processFile(join(SOURCE_DIR, file), destDir, slug);
    const kb = (size / 1024).toFixed(0);
    console.log(`  ${file} → ${destPath.replace(PROJECT_ROOT + '/', '')} (${kb} KB)`);
    processed++;
    totalBytes += size;
  }

  console.log(`\nProcessed ${processed}, skipped ${skipped}. Total output: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
