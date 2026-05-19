#!/usr/bin/env node
// Generate hero images for blog posts using local ComfyUI (Flux Dev Q8 GGUF).
// Adapted from txfitness for the bilingual gugugifts blog.
//
// Usage:
//   node scripts/generate-comfyui-images.mjs --slug <slug>
//   node scripts/generate-comfyui-images.mjs --all
//   node scripts/generate-comfyui-images.mjs --slug <slug> --regenerate
//
// Requires the ComfyUI-GGUF custom node (city96) to be installed and loaded
// on the ComfyUI server. On WSL2 + ComfyUI Desktop on Windows, the script
// auto-detects the Windows host IP from the default gateway.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIRS = [
  path.join(ROOT, 'src', 'content', 'blog'),
  path.join(ROOT, 'src', 'content', 'blog-es'),
];
const IMAGE_DIR = path.join(ROOT, 'public', 'images', 'blog');

// ComfyUI server. Env override wins; otherwise auto-detect WSL→Windows host.
const COMFY = (() => {
  if (process.env.COMFYUI_URL) return process.env.COMFYUI_URL.replace(/\/$/, '');
  try {
    const route = execSync('ip route show default', { encoding: 'utf8' });
    const m = route.match(/default via (\S+)/);
    if (m) return `http://${m[1]}:8000`;
  } catch {}
  return 'http://127.0.0.1:8000';
})();

// Flux Dev Q8 GGUF. cfg=1.0, euler, simple — Flux defaults.
const UNET_MODEL = process.env.COMFYUI_UNET || 'flux1-dev-Q8_0.gguf';
const CLIP_T5 = 't5xxl_fp8_e4m3fn.safetensors';
const CLIP_L = 'clip_l.safetensors';
const VAE_MODEL = 'ae.safetensors';
const STEPS = Number(process.env.COMFYUI_STEPS || 22);
const WIDTH = 1280;
const HEIGHT = 720;

function args() {
  const a = process.argv.slice(2);
  const out = { slug: null, all: false, regenerate: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--slug') out.slug = a[++i];
    else if (a[i] === '--all') out.all = true;
    else if (a[i] === '--regenerate') out.regenerate = true;
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('No frontmatter');
  const lines = m[1].split('\n');
  const fm = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, fmRaw: m[1], body: m[2] };
}

function strip(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/^['"]|['"]$/g, '');
}

function buildPrompt(title, description) {
  const t = strip(title);
  const d = strip(description);
  return (
    `Editorial lifestyle photograph of a bright curated gift shop interior, themed around: ${t}. ${d} ` +
    `Wooden shelves with candles in soft pastel ceramics, vases of fresh flowers, ` +
    `neatly wrapped gift boxes in cream paper with ribbon, arranged on a warm wood counter. ` +
    `Soft natural window light from a tall window, warm cream and gold tones, ` +
    `mid-range subjects in clear focus with gently blurred background, magazine quality, photo-realistic. ` +
    `No text, no signage, no logos, no lettering.`
  );
}

function buildWorkflow(positivePrompt, seed) {
  return {
    "1": {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: UNET_MODEL },
    },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: { clip_name1: CLIP_T5, clip_name2: CLIP_L, type: "flux" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: VAE_MODEL },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: positivePrompt, clip: ["2", 0] },
    },
    "5": {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["4", 0] },
    },
    "6": {
      class_type: "EmptySD3LatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: STEPS,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "gugu-blog", images: ["8", 0] },
    },
  };
}

async function postPrompt(workflow, clientId) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST /prompt ${res.status}: ${txt}`);
  }
  return res.json();
}

async function getHistory(promptId) {
  const res = await fetch(`${COMFY}/history/${promptId}`);
  if (!res.ok) throw new Error(`GET /history ${res.status}`);
  return res.json();
}

async function downloadImage(filename, subfolder, type) {
  const url = new URL(`${COMFY}/view`);
  url.searchParams.set('filename', filename);
  url.searchParams.set('subfolder', subfolder || '');
  url.searchParams.set('type', type || 'output');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /view ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function pollUntilDone(promptId, timeoutMs = 8 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getHistory(promptId);
    const entry = h[promptId];
    if (entry && entry.outputs) {
      for (const nodeId of Object.keys(entry.outputs)) {
        const out = entry.outputs[nodeId];
        if (out.images && out.images.length > 0) {
          return out.images[0];
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for ComfyUI prompt');
}

function findPostFiles(slug) {
  const matches = [];
  for (const dir of BLOG_DIRS) {
    const p = path.join(dir, `${slug}.md`);
    if (fs.existsSync(p)) matches.push(p);
  }
  return matches;
}

function patchHeroImage(filePath, heroPath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const { fmRaw, body } = parseFrontmatter(text);
  const heroLine = `heroImage: "${heroPath}"`;
  let newFm;
  if (fmRaw.match(/^heroImage:/m)) {
    newFm = fmRaw.replace(/^heroImage:.*$/m, heroLine);
  } else {
    newFm = fmRaw.trimEnd() + '\n' + heroLine;
  }
  fs.writeFileSync(filePath, `---\n${newFm}\n---\n${body}`);
}

async function processSlug(slug, regenerate = false) {
  const files = findPostFiles(slug);
  if (files.length === 0) throw new Error(`No post for slug ${slug}`);

  // Pick EN if it exists, else fall back to ES, for prompt seed.
  const enPath = files.find((p) => p.includes(`${path.sep}blog${path.sep}`));
  const seedPath = enPath || files[0];
  const { fm } = parseFrontmatter(fs.readFileSync(seedPath, 'utf8'));

  if (fm.heroImage && !regenerate) {
    console.log(`SKIP  ${slug} (heroImage already set)`);
    return false;
  }

  const title = strip(fm.title) || slug;
  const description = strip(fm.description) || '';
  const prompt = buildPrompt(title, description);
  const seed = crypto.randomInt(1, 2 ** 32 - 1);

  console.log(`GEN   ${slug}`);
  console.log(`      ${prompt.slice(0, 110)}...`);

  const clientId = crypto.randomUUID();
  const wf = buildWorkflow(prompt, seed);
  const { prompt_id } = await postPrompt(wf, clientId);
  const img = await pollUntilDone(prompt_id);
  const png = await downloadImage(img.filename, img.subfolder, img.type);

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const outPath = path.join(IMAGE_DIR, `${slug}.jpg`);
  await sharp(png)
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(outPath);

  const stat = fs.statSync(outPath);
  console.log(`OK    ${slug}.jpg  ${(stat.size / 1024).toFixed(0)} KB`);

  // Patch frontmatter on every file (EN and/or ES) sharing the slug.
  const heroPath = `/images/blog/${slug}.jpg`;
  for (const f of files) {
    patchHeroImage(f, heroPath);
    console.log(`PATCH ${path.relative(ROOT, f)}`);
  }

  return true;
}

async function main() {
  const opts = args();
  const slugs = [];
  if (opts.slug) {
    slugs.push(opts.slug);
  } else if (opts.all) {
    const seen = new Set();
    for (const dir of BLOG_DIRS) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const slug = f.replace(/\.md$/, '');
        if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      }
    }
    slugs.sort();
  } else {
    console.error('Usage: --slug <slug> | --all  [--regenerate]');
    process.exit(2);
  }

  try {
    const res = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`ComfyUI not reachable at ${COMFY}: ${e.message}`);
    process.exit(1);
  }
  console.log(`ComfyUI ${COMFY}  unet=${UNET_MODEL}  steps=${STEPS}`);

  let ok = 0, fail = 0, skip = 0;
  for (const slug of slugs) {
    try {
      const did = await processSlug(slug, opts.regenerate);
      if (did) ok++; else skip++;
    } catch (e) {
      console.error(`FAIL  ${slug}  ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone. ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
