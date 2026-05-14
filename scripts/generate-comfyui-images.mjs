#!/usr/bin/env node
// Generate hero images for blog posts using a remote ComfyUI server.
// Adapted from txfitness for the bilingual gugugifts blog.
//
// Usage:
//   node scripts/generate-comfyui-images.mjs --slug <slug>
//   node scripts/generate-comfyui-images.mjs --all
//   node scripts/generate-comfyui-images.mjs --slug <slug> --regenerate

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIRS = [
  path.join(ROOT, 'src', 'content', 'blog'),
  path.join(ROOT, 'src', 'content', 'blog-es'),
];
const IMAGE_DIR = path.join(ROOT, 'public', 'images', 'blog');

const COMFY = process.env.COMFYUI_URL || 'http://192.168.1.235:8000';
const CHECKPOINT = process.env.COMFYUI_CHECKPOINT || 'juggernautXL.safetensors';
const STEPS = Number(process.env.COMFYUI_STEPS || 28);
const CFG = Number(process.env.COMFYUI_CFG || 6.5);
const SAMPLER = process.env.COMFYUI_SAMPLER || 'dpmpp_2m';
const SCHEDULER = process.env.COMFYUI_SCHEDULER || 'karras';
const WIDTH = 1280;
const HEIGHT = 720;

const NEG =
  'text, watermark, logo, signage, letters, words, typography, captions, brand names, ' +
  'low quality, blurry, deformed, bad anatomy, extra limbs, distorted faces, ' +
  'cartoon, illustration, anime, oversaturated, plastic, fake-looking, ai-artifacts, ' +
  'people facing camera, crowd, cluttered';

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
    `editorial lifestyle photograph, cinematic 16:9 hero image evoking: ${t}. ${d}. ` +
    `Curated mid-luxe gift shop aesthetic, soft natural light, warm cream and gold tones, ` +
    `Texas retail or domestic interior setting, beautiful objects in soft focus, ` +
    `clean composition, magazine quality, depth of field, photo-realistic, high detail, ` +
    `no text, no logos, no signage, no people facing camera`
  );
}

function buildWorkflow(positivePrompt, seed) {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1.0,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: CHECKPOINT },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: positivePrompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: NEG, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
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

async function pollUntilDone(promptId, timeoutMs = 5 * 60 * 1000) {
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
  console.log(`ComfyUI ${COMFY}  checkpoint=${CHECKPOINT}  steps=${STEPS}  cfg=${CFG}`);

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
