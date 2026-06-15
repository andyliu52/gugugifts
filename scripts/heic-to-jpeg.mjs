#!/usr/bin/env node
// Batch-convert iPhone HEIC (HEVC) photos to high-quality JPEG for staging/triage.
//
// sharp's prebuilt binary cannot decode HEVC-HEIC, so we shell out to Python with
// pillow-heif (libde265) for the decode. EXIF orientation is applied, then stripped.
//
// Usage:
//   node scripts/heic-to-jpeg.mjs [srcDir] [outDir]
//   SRC=~/gugupics OUT=~/gugupics/jpg node scripts/heic-to-jpeg.mjs

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC = process.argv[2] || process.env.SRC || join(homedir(), 'gugupics');
const OUT = process.argv[3] || process.env.OUT || join(SRC, 'jpg');
const PY = process.env.PYTHON || '/home/flyin/comfy/ComfyUI/.venv/bin/python';
const QUALITY = Number(process.env.QUALITY || 95);

const PY_SCRIPT = `
import sys, pillow_heif
from PIL import Image, ImageOps
pillow_heif.register_heif_opener()
src, dst, q = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src)
im = ImageOps.exif_transpose(im)          # bake in orientation
if im.mode != "RGB":
    im = im.convert("RGB")
im.save(dst, "JPEG", quality=q, optimize=True)
print(f"{im.width}x{im.height}")
`;

async function main() {
  await mkdir(OUT, { recursive: true });
  const tmpPy = join(OUT, '.heic2jpg.py');
  await writeFile(tmpPy, PY_SCRIPT);

  const entries = await readdir(SRC);
  const heics = entries
    .filter((f) => extname(f).toLowerCase() === '.heic' && !f.includes('Zone.Identifier'))
    .sort();

  if (heics.length === 0) {
    console.log(`No HEIC files in ${SRC}`);
    return;
  }
  console.log(`Converting ${heics.length} HEIC → JPEG q${QUALITY}\n  src: ${SRC}\n  out: ${OUT}\n`);

  let ok = 0;
  for (const f of heics) {
    const dst = join(OUT, `${basename(f, extname(f))}.jpg`);
    try {
      const dims = execFileSync(PY, [tmpPy, join(SRC, f), dst, String(QUALITY)], {
        encoding: 'utf8',
      }).trim();
      console.log(`  ${f} → ${basename(dst)} (${dims})`);
      ok++;
    } catch (e) {
      console.error(`  FAIL ${f}: ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\nDone. Converted ${ok}/${heics.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
