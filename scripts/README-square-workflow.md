# Square → blog post workflow

Pull newly-added items from the Square catalog, then turn them into a bilingual
blog post. Two stages: a script that fetches facts, and a Claude Code session
that writes from those facts.

## One-time setup

1. Go to https://developer.squareup.com/apps, open (or create) an application.
2. **Credentials** tab → copy the **production access token**. It needs read
   scopes only: `ITEMS_READ` and `INVENTORY_READ`.
3. **Locations** tab → copy the location ID for the Terrell store.
4. Create `scripts/.square-credentials.json` (already gitignored):

   ```json
   {
     "accessToken": "EAAAl...",
     "locationId": "LXXXXXXXXXXXX",
     "environment": "production"
   }
   ```

5. Seed the state file so the whole existing catalog counts as "already seen":

   ```
   npm run square:seed
   ```

   This reports nothing. Everything added to Square *after* this point shows up
   as new on later runs.

## Regular use

```
npm run square:new
```

Writes two files (both gitignored):

- `scripts/.square-new-items.json` — structured data
- `scripts/.square-new-items.md` — readable brief, grouped by category

It also records the new item IDs as seen, so the next run reports only what
came in after. Use `npm run square:dry-run` to look without recording.

Other flags:

| Flag | Effect |
| --- | --- |
| `--since=2026-07-01` | Only fetch objects Square modified since this date. Faster on a large catalog, but it filters on *modified*, not *created* — a price edit counts. |
| `--limit=15` | Cap items in the brief. State is **not** updated when truncated, so nothing gets silently skipped. |
| `--no-inventory` | Skip the stock-count lookup. |
| `--dry-run` | Report without recording items as seen. |

### Why a state file instead of a date filter

Square's Catalog API has no `created_at` on catalog objects. `begin_time`
filters on modification time, which also fires when you edit a price or an
item gets restocked. Diffing against a local set of seen IDs is the only way
to reliably answer "what's actually new." The tradeoff: if the state file is
lost, re-seed with `npm run square:seed` and the first genuinely-new batch
after that is what you'll get.

## Turning a brief into a post

In a Claude Code session in this repo:

> Read `scripts/.square-new-items.md` and draft a bilingual blog post about the
> new arrivals. Follow the conventions in `src/content/blog/`.

What to expect and check:

- **Post shape.** EN file in `src/content/blog/<slug>.md`, ES translation at
  `src/content/blog-es/<slug>.md` with the same slug, same `date`, same
  `heroImage`. Internal links use `/blog/...` in EN and `/es/blog/...` in ES.
- **Scheduling.** A future `date` keeps the post hidden until that day —
  `src/pages/blog/index.astro` filters on `data.date <= now` in production,
  and `.github/workflows/scheduled-publish.yml` triggers the rebuild at
  12:00 UTC daily when a post is dated that day.
- **Prices.** The brief carries real prices from Square. Prices in existing
  posts are hand-written and may be stale — trust the brief.
- **Descriptions.** Square item descriptions are usually vendor copy. They're
  a factual starting point, not publishable prose.
- **Stock.** The brief includes on-hand counts. Don't build a post around an
  item with 1 left.

## Hero images

New posts need `public/images/blog/<slug>.jpg`. Generate with the local
ComfyUI setup (Z-Image-Turbo, running in WSL at `127.0.0.1:8188`):

```
node scripts/generate-comfyui-images.mjs --slug <slug> --regenerate
```

`--regenerate` is needed whenever the post's frontmatter already has a
`heroImage:` line — the script skips on that field, not on whether the file
actually exists.

The prompt is derived from the post's **description**, not the title: a title
reads to the model as a headline instruction and gets rendered into the image
as text. Always eyeball the result before publishing — Z-Image will invent
signage given any excuse, and a misspelled "Gugu Gists" on a shop wall is not
recoverable in post.

Square product photos in the brief are a reasonable alternative if you would
rather use a real product shot than a generated scene.

## Suggested cadence

Monthly works well: run `npm run square:new` at the start of the month, and if
there are eight or more genuinely new items worth writing about, that's a
"what's new at Gugu Gifts" post. Fewer than that, let them accumulate or fold
them into a seasonal post instead.
