# Square → blog + social workflow

Two tracks share one Square pull: bilingual blog posts, and scheduled social
posts pushed to Facebook / Instagram / Google Business Profile through the
GoHighLevel Social Planner API.

## Quick reference

| Command | Does |
| --- | --- |
| `npm run square:seed` | One-time: mark the current catalog as already seen |
| `npm run square:new` | Report items added since the last run |
| `npm run square:catalog` | Snapshot everything in stock → `social/catalog-snapshot.{json,md}` |
| `npm run ghl:accounts` | Read-only: list connected FB/IG/GBP accounts and their IDs |

---


Pull newly-added items from the Square catalog, then turn them into a bilingual
blog post. Two stages: a script that fetches facts, and a Claude Code session
that writes from those facts.

## One-time setup

1. Go to https://developer.squareup.com/apps, open (or create) an application.
2. **Credentials** tab → copy the **production access token**. The pull scripts
   need `ITEMS_READ` and `INVENTORY_READ`. The token currently in use also has
   `ITEMS_WRITE`, which `tax-holiday.mjs` and `retire-tax.mjs` require — treat
   this token as write-capable, not read-only.
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

## GoHighLevel social scheduling

Posts go out through the Social Planner **API**, not a CSV import. That
removes the manual upload step, the 90-rows-per-file cap, and the 40-column
positional CSV format entirely.

### Setup

1. In GHL, open the **Gugu Gifts** sub-account (not TX Fitness) → Settings →
   Private Integrations → create a token with scopes:
   `socialplanner/post.write`, `socialplanner/account.readonly`,
   `medias.readonly`, `medias.write`.
2. Connect Facebook, Instagram and Google Business Profile under
   Marketing → Social Planner → Settings.
3. Create `scripts/.ghl-credentials.json` (gitignored):

   ```json
   {
     "apiToken": "pit-...",
     "locationId": "<Gugu Gifts sub-account id>",
     "userId": "<a user id in that sub-account>",
     "timezone": "America/Chicago"
   }
   ```

4. `npm run ghl:accounts` — read-only. Prints every connected account with the
   `id` values that `accountIds` needs. Copy them back into the credentials
   file under `"accounts"`. These IDs cannot be guessed or derived.

### Why the account probe comes first

`CreatePostDTO.accountIds` takes GHL's internal account IDs, and a post
targeting Facebook vs Instagram vs GBP is the *same* endpoint with different
IDs. The probe is also how you find out a connection has silently expired —
`isExpired` on an account means posts to it fail at publish time, hours after
the API accepted them.

### Scheduling and the DST trap

Posts are scheduled for **5:00 PM local time in Terrell**. The campaign window
crosses the time change: America/Chicago is UTC-5 through 2026-11-01 and UTC-6
after. A hardcoded offset would post an hour off for part of the run, so
`zonedToUtc()` in `scripts/lib/ghl.mjs` resolves the real offset per date.

Note "5pm CST" strictly means UTC-6 year-round; what's implemented is 5pm on
the clock in Terrell, which is what people mean. `npm run ghl:accounts` prints
a sanity check on both sides of the boundary.

### Two API versions on one host

Social Planner endpoints want `Version: v3`. Media Storage wants
`Version: 2021-07-28`. Sending the wrong one returns a confusing 422 rather
than a clear error. `ghlFetch()` handles this per-endpoint.

### Cloudflare

Every GHL request needs a browser-like `User-Agent`. Undici's default is
literally `node`, which Cloudflare 1010-bans. Set once in `ghlFetch()`.

## Texas sales tax holiday

`scripts/tax-holiday.mjs` turns the 8.25% sales tax off for qualifying items
during the August holiday and puts it back exactly as it was. Texas exempts
clothing, footwear, student backpacks and a closed list of school supplies
priced **under $100** — not the jewelry, candles or greeting cards that make up
most of this shop.

| Command | Does | Writes |
| --- | --- | --- |
| `npm run tax:plan` | Classify the live catalog, print the review table, write the manifest | local only |
| `npm run tax:status` | Is the exemption on right now? | nothing |
| `npm run tax:apply -- --commit` | Strip the taxes | **Square** |
| `npm run tax:restore -- --commit` | Put back exactly what was recorded | **Square** |

### Scopes

The live token **already has `ITEMS_WRITE`** — verified 2026-08-07 with an
idempotent no-op call. The "read scopes only" line further up this file was
never true of the token actually in use.

If that ever changes, `--apply` preflights with the same no-op write, so a
missing scope fails immediately with a clear message rather than half-way
through the catalog. Everything except `--apply --commit` / `--restore --commit`
is read-only regardless.

### Order of operations

1. `npm run tax:plan`. Read the table. Ambiguous items — journals, planners,
   pen cases, desk pads — default to **excluded**; set `"include": true` in
   `social/tax-holiday-2026.json` and re-run to flip one. Your edits survive
   the re-run.
2. Probe a single item first:
   `node scripts/tax-holiday.mjs --apply --only=<itemId> --commit`, then check
   it in the POS.
3. `npm run tax:apply -- --commit`. It verifies with a fresh read afterwards,
   because the API response carries no per-item result.
4. Restore when the shop is closed — Monday for the Aug 7–9 holiday.
5. Commit `social/tax-holiday-2026.json` and `social/tax-holiday-state.json`.
   The manifest is the reusable group; the state file is the only record of
   what each item's taxes were beforehand.

### How it works, and why not the simpler way

`Local Sales Tax` is bound to an `all_products` product set. While that binding
exists Square will not let you drop the tax from one item, and will not accept a
narrower product set on the tax either. So `--apply` **swaps the tax out**:
creates a second tax at the same rate with no product set, attaches it to the
~1,807 items that should still be taxed, then disables the original and enables
the new one. `--restore` reverses that and deletes the temporary tax.

The switch is ordered disable-then-enable so the gap is a moment of *no* tax
rather than *double* tax.

Note the usual online advice — "disable your sales tax and add a 0% holiday
tax" — is wrong for a gift shop. Taxes are additive, so 0% alongside 8.25%
still charges 8.25%, and disabling the original would stop collection on the
94% of the catalog that does not qualify.

**Configuration correctness is not proof.** Ring a real POS test sale on one
exempt and one non-exempt item before trusting a run.

**Custom amounts are out of reach.** The tax applies to custom amounts, so a
qualifying item keyed in as a quick sale is still taxed. Staff must ring those
items by their catalog entry.

### Retiring a duplicate tax

`scripts/retire-tax.mjs` strips a tax from every item that carries it and can
delete the object. Used once, on 2026-08-07, to retire a disabled duplicate
`TX Sales Tax` that sat on 294 items — it made prior tax state non-uniform and
would have re-taxed exempted items if anyone had enabled it.

```
node scripts/retire-tax.mjs --tax=<id>                    # dry run
node scripts/retire-tax.mjs --tax=<id> --commit           # strip from items
node scripts/retire-tax.mjs --tax=<id> --commit --delete-object
node scripts/retire-tax.mjs --tax=<id> --undo --commit    # re-attach
```

It refuses to touch an enabled tax, or one with `applies_to_product_set_id`,
or one that is any item's only tax, unless `--force`. The item list is recorded
to `social/retired-tax-<id>.json` so `--undo` works; deleting the object is
irreversible because a re-created tax gets a new id.

## Suggested cadence

Monthly works well: run `npm run square:new` at the start of the month, and if
there are eight or more genuinely new items worth writing about, that's a
"what's new at Gugu Gifts" post. Fewer than that, let them accumulate or fold
them into a seasonal post instead.
