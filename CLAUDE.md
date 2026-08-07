# Gugu Gifts

Astro 5 static site for a gift shop at 301 Tanger Dr, Suite 112, Terrell, TX
(The Shops at Terrell, I-20 Exit 501). Plain `.mjs` scripts, no build step for
tooling, `sharp` is the only image dependency.

Deployed on Vercel from `main`.

## Before you touch the content pipeline

Load the **`square-ghl-pipeline`** skill. It records the Square, GoHighLevel and
ComfyUI behaviours that cost live failures to discover and appear in no vendor
doc. Do not re-derive them.

## Non-negotiables

**Verify prices against Square.** Posts inherit prices from older posts and
drift. An audit found Julie Vos described as "$16–$28 entry pieces" when the
line is $65–$395. Check every `**Name ($NN)**` claim against
`social/catalog-snapshot.json` before publishing. Brands often live in the
Square *category*, not the item name, so a name-only match can return nothing.

**The shop is closed Mondays.** Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM. Check any
post that suggests a day to visit — a Labor Day guide once told readers to come
on the Monday holiday.

**Blog posts are bilingual.** EN at `src/content/blog/<slug>.md`, ES at
`src/content/blog-es/<slug>.md` — same slug, date and `heroImage`. Links are
`/blog/…` in EN and `/es/blog/…` in ES. Social posts are English only.

**A future `date` hides a post** until `.github/workflows/scheduled-publish.yml`
fires at 12:00 UTC on that day. That is the scheduling mechanism; there is no
draft workflow.

**Scheduling posts is outward-facing.** `schedule-ghl-posts.mjs` dry-runs by
default and needs `--commit`. GHL does not de-duplicate. Probe with
`--only=<id> --commit` before any bulk run.

## Commands

```
npm run build                  # 93+ pages; run before committing content
npm run square:catalog         # snapshot in-stock items -> social/
npm run square:new             # what's been added since last run
npm run social:group           # theme the catalog -> social/groups.json
npm run ghl:accounts           # read-only: connected FB/IG/GBP account ids
npm run social:validate        # check posts.json, no network
npm run social:schedule        # dry run
npm run blog:heroes            # blog heroes from real Square photos
npm run generate-images        # ComfyUI heroes (needs 127.0.0.1:8188 up)
```

## Layout

```
src/content/blog{,-es}/    bilingual posts
src/assets/gallery/        9 real photographs of the shop — better than
                           anything generated; use them
public/images/blog/        hero images
scripts/lib/               square.mjs, ghl.mjs
social/                    generated, gitignored EXCEPT posts.json
                           (hand-authored captions) and .ghl-posted.json
                           (losing it means double-posting)
scripts/.*-credentials.json  gitignored
```

## Data quality, as of Aug 2026

The Square catalog is 1,924 items / 1,789 in stock across 31 categories. Two
things about it that will bite:

- **More than half the product image URLs are ~110×50 placeholders**, not
  photos — including every Japanese stationery brand. Counting image URLs
  overstates coverage; validate dimensions before use.
- **37 trade SKUs sit alongside retail** (`Set/24 Assorted`, `Pre-Pack`, a
  $0.02 counter display). `group-catalog.mjs` filters them; anything else
  reading the catalog must too.
