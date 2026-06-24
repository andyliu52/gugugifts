// Generates a branded 1200×630 social-share (Open Graph) image for each SEO
// landing page and writes it to public/og/<slug>.jpg.
//
// Images are pre-generated and committed so production builds don't depend on
// system fonts being present. Re-run after changing page titles:
//
//   npm run generate-og
//
// (The npm script passes --experimental-strip-types so this .mjs can import the
// TypeScript page data directly.)

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { seoPages } from '../src/data/seoLandingPages.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/og');

const COLORS = {
  cream: '#FAF7F2',
  creamDark: '#F0EBE3',
  bronze: '#54504A',
  warmgray: '#A69E95',
  gold: '#C9A96E',
};

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Greedy word wrap to an approximate max characters-per-line.
function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svgFor(page) {
  const W = 1200;
  const H = 630;
  const titleLines = wrap(page.h1, 22).slice(0, 3);
  const titleSize = titleLines.length > 2 ? 76 : 88;
  const lineHeight = titleSize * 1.15;
  // Vertically center the title block in the available space.
  const blockHeight = titleLines.length * lineHeight;
  let y = 300 - blockHeight / 2 + titleSize;

  const titleTspans = titleLines
    .map((l) => {
      const t = `<text x="90" y="${Math.round(y)}" font-family="DejaVu Serif, Georgia, serif" font-size="${titleSize}" font-weight="bold" fill="${COLORS.bronze}">${escapeXml(l)}</text>`;
      y += lineHeight;
      return t;
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLORS.cream}"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="${COLORS.gold}" stroke-opacity="0.45" stroke-width="2" rx="18"/>
  <text x="90" y="150" font-family="DejaVu Sans, sans-serif" font-size="26" letter-spacing="6" fill="${COLORS.gold}">${escapeXml(page.eyebrow.toUpperCase())}</text>
  ${titleTspans}
  <line x1="90" y1="490" x2="250" y2="490" stroke="${COLORS.gold}" stroke-width="3"/>
  <text x="90" y="548" font-family="DejaVu Sans, sans-serif" font-size="30" fill="${COLORS.bronze}"><tspan font-weight="bold">gugu</tspan>gifts</text>
  <text x="90" y="588" font-family="DejaVu Sans, sans-serif" font-size="24" fill="${COLORS.warmgray}">Tanger Outlets · Terrell, TX</text>
</svg>`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let count = 0;
  for (const page of seoPages) {
    const svg = svgFor(page);
    const out = resolve(outDir, `${page.slug}.jpg`);
    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(out);
    count++;
  }
  console.log(`Generated ${count} OG images in public/og/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
