---
name: square-ghl-pipeline
description: Hard-won gotchas for the Gugu Gifts content pipeline — Square Catalog/Inventory, the GoHighLevel Social Planner API, and local ComfyUI image generation. Load this BEFORE touching scripts/lib/square.mjs, scripts/lib/ghl.mjs, scripts/schedule-ghl-posts.mjs, scripts/pull-square-*.mjs, scripts/group-catalog.mjs, scripts/build-blog-heroes.mjs, or scripts/generate-comfyui-images.mjs; before scheduling or drafting social posts; and before writing any blog post that quotes a product price. Every item here cost a live failure or a wrong-data bug to discover and none of it is in the vendor docs.
---

# Square → GHL content pipeline

Facts established by probing the live systems. Where a claim is counter-intuitive
the failure it prevents is stated, because that is the part that makes it stick.

## Rule zero: verify prices against the catalog

Blog posts inherit prices from older posts and drift. An audit against the live
snapshot found Julie Vos described as "$16–$28 entry pieces" when the line is
**$65–$395** — the most expensive thing in the shop, framed as the cheapest.
Also wrong: Kaweco $25 (real $28), Voluspa Lychee $22 (real $34, and it only
exists in 18 oz), Greenleaf sachets $3 (real $1.38–$1.50).

Before publishing any post with a price, grep every `**Name ($NN)**` claim and
match it against `social/catalog-snapshot.json`. Note that brand names often
live in the Square *category*, not the item name, so a name-only match returns
nothing for Julie Vos — check the group.

## GoHighLevel Social Planner

### Get the schema from the SDK, not the docs

`marketplace.gohighlevel.com` renders request schemas client-side; a fetch
returns an empty shell. The real types are in the published SDK:

```
npm pack @gohighlevel/api-client
dist/lib/code/social-media-posting/models/social-media-posting.d.ts
```

`CreatePostDTO` requires `accountIds`, `type`, and `userId`. But several fields
are typed `any`, and those are exactly the ones that 422 — see below.

### Two API versions on one host

| Endpoint family | `Version` header |
| --- | --- |
| `/social-media-posting/*` | `v3` |
| `/medias/*` | `2021-07-28` |

Wrong one gives a confusing 422 rather than a clear error.

### Cloudflare bans the default User-Agent

Undici's default UA is literally `node`, which gets 1010-banned. Set a browser
UA on **every** request, including HEAD checks and image downloads.

### The enum values that are not in any type

```js
media: [{ url, type: 'image/jpeg' }]   // MIME type. NOT 'image'/'IMAGE'/'photo'/'jpg'
gmbPostDetails: { gmbEventType: 'STANDARD' }  // uppercase STANDARD|EVENT|OFFER
```

There is **no `call_to_action` value** for `gmbEventType`, even though the bulk
CSV format's `eventType` column uses exactly that string. A plain CTA post is
`STANDARD`; `actionType` (`learn_more`, `shop`, …) stays lowercase.

Discovered values: `type` is `post|reel`, `status` is
`scheduled|published|failed|draft`, `scheduleDate` is ISO-UTC with milliseconds.

### Drafts skip media validation — this is the trap

`status: 'draft'` accepts **any** `media[].type`, including garbage.
Validation only runs for `status: 'scheduled'`. A draft round-trip therefore
proves nothing about whether your payload is correct. Always probe with
`status: 'scheduled'`, and delete the result.

### Response shape is nested

`listPosts` returns `{ results: { posts: [...], count } }`, **not**
`{ posts: [...] }`. Reading `r.posts` silently yields zero results — which
during a cleanup looks exactly like "nothing to delete" and leaves live posts
in place. Always read `r.results.posts`.

### Listing quirks

- `fromDate`/`toDate` do **not** filter on `scheduleDate`. A narrow window
  around a post's schedule date returns nothing.
- The 100-item page fills with published posts, so recent items fall off the
  end. Paginate with `skip` before concluding something is absent.
- Deletes are eventually consistent — a read immediately after can return an
  empty list. Sleep and re-read before panicking.

### accountIds are opaque

They cannot be derived or guessed. Read them from
`GET /social-media-posting/{locationId}/accounts` (`npm run ghl:accounts`) and
store them. Also check `isExpired` — an expired connection accepts the API call
and fails silently at publish time, hours later.

### GHL does not de-duplicate

Running a scheduler twice creates two sets of posts. Keep a state file keyed by
`postId::platform`, persist it **after each individual call** so a crash
mid-run cannot re-post, and require an explicit `--commit` flag.

### Never retry a create on a timeout

GHL returns **524** under load. A 524 is a gateway giving up waiting, which
means the request may have **succeeded server-side with the response lost**.
Retrying `POST /posts` on that creates a second identical scheduled post whose
id the state file does not know — so it is invisible to every subsequent
`--commit` and has to be found by scanning for duplicate `scheduleDate`s.

This happened on a real run. Retry policy must distinguish:

- **429** — definitively not processed, safe to retry on anything.
- **5xx / timeout** — retry only for reads. For creates, surface the failure
  and let the operator check.

`POST /posts/list` is a POST but a pure read, so it is explicitly marked
retryable. After any run that reported a timeout, scan for duplicate schedule
slots before assuming the state file is accurate.

### One post, many channels — put every accountId in one call

`accountIds` is an array and the default usage is **one call listing every
target channel**. That produces a single entry in the Social Planner with all
socials attached, so an edit or reschedule is one action instead of three.
Splitting into one call per platform is the *customization* path, for when a
channel needs different copy — only do it when a post carries a distinct
`gbpCaption`.

Getting this wrong is not a hard failure, just three times the objects to
manage: 60 entries where 20 would do.

### `platform` in responses is not a targeting signal

Every API-created post comes back `platform: "google"` regardless of which
accounts it targets — including a combined post whose `accountIds` correctly
holds all three. UI-created posts do have it set per channel. Treat the field
as a denormalized artifact and trust `accountIds`; do not "fix" it.

## Square Catalog & Inventory

### Untracked inventory is not zero stock

`batch-retrieve` returns **no count at all** for a variation with
`track_inventory` off. Treating a missing count as zero silently deletes those
items — 13% of this catalog (241 of 1,924). Correct rule:

```
sellable = trackInventory === true ? count > 0 : true   // untracked ⇒ on the shelf
```

Track `stockKnown` separately so copy can say "in stock" without inventing a number.

### There is no created_at

`begin_time` on `/v2/catalog/search` filters **modified** time, which also fires
on price edits and restocks. "New" can only be determined by diffing against a
local set of seen IDs. Keep that state file away from any full-snapshot run, or
the baseline is destroyed and can only be rebuilt by re-seeding.

### The category is often the brand

For this catalog: 63% of items are categorized and the category **is** the brand
(`Splendid Iris`, `Rain Jewelry`, `Julie Vos`) with item names being plain
product descriptors. The other 37% are uncategorized with the brand leading the
name (`KAWECO …`, `OSCOLABO stamp …`). Group by category first, fall back to
name-brand only when uncategorized. Do not derive a brand list from blog
frontmatter tags — that yields "Cinco de Mayo", "Thanksgiving" and "TxDOT".

### Trade SKUs live alongside retail

The catalog contains supplier pack, display and sample lines: `Set/24 Assorted`,
`Pre-Pack`, `FREE 12PC Retail Counter Display` at $0.02. Posting these as offers
is actively misleading. Filter on `set/\d+`, `pre-?pack`, `display`,
`free \d+ ?pc`, `assorted`, `MOQ`, `tester`.

### Product image URLs are frequently placeholders

More than half of this catalog's image URLs return a ~110×50 strip instead of a
photo — including every Japanese stationery brand, and Brenda Grands, which
reports 45 "photos" of which none are usable. **Counting image URLs overstates
photo coverage.** Download and check `min(width,height) >= 500` before using any
Square image, and fall back to `src/assets/gallery/` (real shop photographs).

Money is in cents. `image_data.url` is public but not permanent — a re-upload
mints a new URL, so the image **id** is the stable join key.

### One tax object now — it used to be two

**Current state: a single `Local Sales Tax` (`YMJKIFWDYDWLX6ZPSUCQIEAG`), 8.25%,
enabled, on all 1,933 items.**

There was a second, `TX Sales Tax` (`MVY6O7…`) — same 8.25%, `enabled: false`,
sitting on 294 items. Retired 2026-08-07 via `scripts/retire-tax.mjs`: stripped
from all 294, then the object deleted. The undo record (the 294 item ids) is at
`social/retired-tax-MVY6O7VQ4P5JXKSKRVLSARQT.json`.

Worth knowing because the shape recurs: a disabled duplicate tax on a subset of
items means **prior tax state is not uniform**, so anything that strips and
restores tax must record *each item's own* `tax_ids` rather than assume one
value. Do not reintroduce a second tax object.

`applies_to_custom_amounts: true`, so a keyed-in custom amount is taxed no
matter what the catalog says. No script can reach that; it is a staff
instruction.

### A product-set-bound tax cannot be scoped — swap it out instead

`Local Sales Tax` carries `applies_to_product_set_id` →
`JMGQGH5Q4BIU6WNUXAZU7XRN` = `{ all_products: true }`. That binding blocks both
obvious ways to exempt a subset of items, and the errors are worth knowing so
nobody burns an afternoon rediscovering them:

```
update-item-taxes, taxes_to_disable: [thatTax]
  -> "FEE objects passed in the taxes_to_disable field must not have an
      associated PRODUCT_SET"

upsert tax with applies_to_product_set_id -> a product_ids_any set
  -> "Product set (...) found on tax ... is invalid."
```

So the product set governs application, it only tolerates `all_products`, and
you cannot detach the tax from one item while it is bound.

**What works:** leave the original alone and swap. A *newly created* tax has no
product set, so per-item assignment is allowed. Create a second tax at the same
rate (disabled), attach it to the items that SHOULD be taxed, then disable the
original and enable the new one. `scripts/tax-holiday.mjs` does this.

**Order the switch disable-then-enable.** The gap between the two writes is
then a moment of no tax rather than a moment of double tax — under-collecting
briefly beats overcharging a customer.

**The common online advice does not work here.** "Disable your sales tax and
add a 0% holiday tax" assumes a shop where everything qualifies. Taxes are
`ADDITIVE`, so a 0% tax next to an 8.25% one still charges 8.25%; and disabling
the original stops collection on the ~94% of this catalog that does not
qualify. Scope the *replacement* to the non-exempt items instead.

Configuration correctness is still not proof of what the register charges —
confirm with a real POS sale.

### `update-item-taxes` is idempotent — the opposite of the GHL rule

`POST /v2/catalog/update-item-taxes` takes item ids and tax ids and nothing
else. No object body, so no `version` to go stale and no way to clobber
variations the way a partial `batch-upsert` would. It is a declarative set
operation, so **retrying on a 5xx is safe** — unlike GHL's `POST /posts`, which
mints an object per call. `withRetry` needs no opt-out here.

Two consequences that are about bookkeeping, not the API:

- **Record prior state *before* the call, not after.** A 5xx may have succeeded
  server-side. Holding a prior-state entry for an item that was never changed is
  harmless (re-enabling a tax it still has is a no-op); missing one is not.
- **Write prior state ONCE.** On a re-run the "current" tax_ids are the already
  stripped ones. Overwriting records "this item had no tax", and the restore
  then puts nothing back — permanently ending collection on it, silently.
- The response is `{updated_at, errors}` with **no per-item result**. A 200
  means the batch was accepted, not that every item is correct. Verify by
  re-reading.

### Classifying items: deny must beat allow, and the category is a signal

Building the tax-holiday exempt list, name-only keyword rules produced three
false positives that each look right in isolation: `Freshcut **Paper** Pop Up
Cards` (greeting cards, matched "paper"), `OSCOLABO **Ruler** stamp` (a rubber
stamp — and the only item in the catalog containing "ruler"), and `COWBOY
**BOOT** TRINKET DISH` (a dish). Every "Notes & Queries" item is a greeting
card with a name like `HB Multi Stars Paper Ros` containing no "card" at all —
there, only the category tells you.

Rules that worked: deny wins over allow; deny by *category* for brand houses
that stock nothing qualifying; and **no blanket "this allow rule beats a
category deny" escape** — one was tried and immediately let `Tag`'s trinket
dish through as footwear and `Ty`'s "chick w hat" through as clothing.

## Images

### ComfyUI

Runs natively in WSL at `127.0.0.1:8188` (`~/comfy/ComfyUI`), **not** on the
Windows host. Model is Z-Image-Turbo (`z_image_turbo_bf16`, CLIP `qwen_3_4b`
loaded with the `lumina2` handler, 8 steps, `res_multistep`). The old Flux GGUF
path is dead — its t5xxl/clip_l encoders were deleted from disk.

**cfg is 1.0, so the negative prompt is a zeroed copy of the positive.** Saying
"no text, no signage, no logos" therefore *summons* signage rather than
suppressing it — a first pass produced a shop sign reading "Gugu Gists /
Terreill-TX". Describe surfaces as blank positively instead. Likewise, never put
the post title in the prompt: it reads as a headline instruction and gets
rendered into the frame. Build from the description only, and eyeball every
frame.

### Prefer real photos, and compose them correctly

A real Square product photo beats a generated scene for any product post.
Product shots are square on white, so **cover-cropping to 16:9 slices the item
in half** — composite with `contain` onto a *white* canvas (a tinted canvas
leaves a visible seam box). Real shop photos from `src/assets/gallery/` are
scenes and do get cover-cropped.

## Repo conventions

- Credentials: `scripts/.<service>-credentials.json`, gitignored, with
  `FILL_IN_` placeholders guarded so an unfilled file fails clearly instead of
  returning a bare 401.
- `social/*` is gitignored except `social/posts.json`, the one hand-authored
  artifact. Everything else regenerates from Square.
- Blog posts are bilingual: `src/content/blog/<slug>.md` and
  `src/content/blog-es/<slug>.md`, same slug/date/heroImage, `/blog/…` vs
  `/es/blog/…` links. A future `date` hides a post until
  `.github/workflows/scheduled-publish.yml` fires at 12:00 UTC.
- The shop is **closed Mondays** (Tue–Sat 10–7, Sun 11–6). Check any post that
  suggests a visit day — a Labor Day guide once told readers to come on the
  Monday holiday.
- Social posts are English only; the blog carries Spanish.

## Scheduling across DST

Posts go out 5 PM America/Chicago. A fall campaign crosses the boundary —
UTC-5 through 2026-11-01, UTC-6 after — so a hardcoded offset puts a third of a
Sep–Dec run an hour off. Resolve the offset per date (`zonedToUtc` in
`scripts/lib/ghl.mjs`) and verify a date on each side.

## Probing live systems safely

Determining the above required creating real posts on a real business account.
Rules that made that safe:

1. Probe with the smallest unit first — `--only=<oneId> --commit` creates 3
   posts, not 60. The first real run failed on all 3; at full scale that would
   have been 60 failures to clean up.
2. Track every object created and delete it in the same session — including
   media-library uploads, which are easy to forget.
3. Before concluding cleanup succeeded, re-read with the correct response path
   and full pagination. A cleanup that reports "0 found" is far more often a
   query bug than an empty result.
