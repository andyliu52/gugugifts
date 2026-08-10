// Texas Sales Tax Holiday — which catalog items are exempt.
//
// The Comptroller's qualifying list, encoded as data so the reasoning is
// auditable: every verdict the script prints names the rule that produced it.
//
// Source: comptroller.texas.gov/taxes/publications/98-490/ (and the
// school-supplies sub-page). Exempt during the holiday, each item priced UNDER
// $100: clothing and footwear, student backpacks, and a CLOSED list of school
// supplies. Explicitly NOT exempt: jewelry, handbags, purses, briefcases,
// luggage, wallets, watches, umbrellas; framed backpacks, athletic/duffle/gym
// bags, computer bags; specially-designed athletic or protective clothing.
//
// Three buckets, evaluated DENY -> AMBIGUOUS -> ALLOW, and deny wins. That
// order is not stylistic. Real collisions in this catalog:
//
//   "Freshcut Paper Pop Up Cards"  — matches ALLOW on "paper", but greeting
//                                    cards are not on the list.  (15 items)
//   "OSCOLABO Ruler stamp"         — matches ALLOW on "ruler", but it is a
//                                    rubber stamp, not a ruler.
//   "EMMIE - chick w hat reg"      — matches ALLOW on "hat", but it is a Ty
//                                    plush toy.
//
// DENY is deliberately NARROW. It only has to overrule things that would
// otherwise match ALLOW — it is not a general-purpose "not a school supply"
// filter, and widening it causes false negatives. A dropped food or houseware
// noun here does nothing, because those items never match ALLOW in the first
// place; but adding e.g. /\bcoffee\b/ would wrongly kill "Coffee 3D socks".

// A rule is { label, re, unless? }. `unless` is a carve-out: if it matches,
// the rule does not fire.
// A strong writing-instrument noun outranks a decorative adjective:
// "Cute Sea Animals Charm Pen" is a pen, not a charm.
const IS_WRITING = /\b(pens?|pencils?|notebooks?|erasers?)\b/i;

export const DENY = [
  { label: 'jewelry',
    re: /\b(necklaces?|bracelets?|earrings?|bangles?|pendants?|anklets?|brooch(es)?|charms?|jewell?ry)\b/i,
    unless: IS_WRITING },
  // "Ring Binder" is a qualifying school supply; a ring is not.
  { label: 'ring', re: /\brings?\b/i, unless: /\bbinders?\b/i },
  { label: 'keychain', re: /\b(keychains?|key ?rings?)\b/i },
  { label: 'watch', re: /\bwatch(es)?\b/i },
  // Named exclusions. Note "book bag"/"backpack" are NOT here — those qualify.
  { label: 'excluded-bag',
    re: /\b(purses?|handbags?|clutch(es)?|crossbody|wallets?|briefcases?|luggage|duffle|duffel|gym bags?|computer bags?|laptop bags?)\b/i },
  { label: 'umbrella', re: /\bumbrellas?\b/i },
  // Greeting cards are not on the list. Index cards are.
  { label: 'greeting-card', re: /\bcards?\b/i, unless: /\bindex cards?\b/i },
  { label: 'gift-wrap',
    re: /\b(gift ?wrap|wrapping paper|tissue paper|gift bags?|gift ?bows?|ribbons?)\b/i },
  { label: 'sticker', re: /\bstickers?\b/i },
  // Rubber stamps. Catches "OSCOLABO Ruler stamp".
  { label: 'stamp', re: /\bstamps?\b/i },
  { label: 'plush', re: /\b(plush|stuffed animals?|beanie boos?)\b/i },
  // Paper party hats sold 8 to a pack are party supplies, not wearing apparel.
  { label: 'party-supply', re: /\bparty (hats?|supplies|favou?rs?)\b/i },
  // Tabletop and decor. "COWBOY BOOT TRINKET DISH" matched the footwear rule
  // on "boot" — it is a dish.
  { label: 'home-decor',
    re: /\b(trinkets?|dish(es)?|bowls?|plates?|vases?|platters?|coasters?|ornaments?|figurines?|candles?|diffusers?|tapers?)\b/i },
  { label: 'cosmetic', re: /\b(makeup|make-up|cosmetics?)\b/i },
  { label: 'eyewear', re: /\b(sunglass(es)?|eyewear|readers?)\b/i },
  // Specially-designed athletic or protective gear is excluded even though it
  // is worn. Ordinary athletic-styled clothing (jogging suits, tennis shoes)
  // is fine, so this is limited to genuinely protective items.
  { label: 'athletic-protective',
    re: /\b(cleats?|shin guards?|shoulder pads?|helmets?|mouth ?guards?)\b/i },
];

// A "Pen Case" is not a pen and a "Pencil Pouch" is not a pencil — both are
// genuine judgement calls, so this carve-out hands them to AMBIGUOUS rather
// than letting the generic noun claim them as firm qualifiers.
const CARRIER = /\b(pen|pencil) ?(pouch(es)?|cases?|bags?)|\bpencases?\b/i;

export const ALLOW = [
  // --- the Comptroller's school-supply list, verbatim in intent ---
  { label: 'pens', re: /\b(pens?|ballpens?|rollerballs?|ballpoints?|fountain pens?|gel pens?)\b/i,
    unless: CARRIER },
  { label: 'pencils', re: /\bpencils?\b/i, unless: CARRIER },
  { label: 'pencil-box', re: /\bpencil (box(es)?|sharpeners?)\b/i },
  { label: 'notebooks',
    re: /\b(notebooks?|note ?books?|composition books?|stitched notebooks?|function note)\b/i },
  // LACONIC "A5 Creative Pad" / "A5 Field Pad" are writing tablets. Kept to
  // named pad types on purpose — a bare /\bpad\b/ would sweep in desk pads,
  // mouse pads and Studio Oh!'s decorative blotters.
  { label: 'writing-pads',
    re: /\b(legal pads?|writing pads?|writing tablets?|creative pads?|field pads?|memo pads?|notepads?)\b/i },
  { label: 'binders-folders', re: /\b(binders?|folders?|index cards?)\b/i },
  { label: 'erasers', re: /\berasers?\b/i },
  { label: 'markers', re: /\b(markers?|highlighters?|crayons?|chalk)\b/i },
  { label: 'glue', re: /\b(glue|paste)\b/i },
  { label: 'measuring', re: /\b(rulers?|protractors?|compass(es)?)\b/i },
  { label: 'scissors', re: /\bscissors\b/i },
  { label: 'calculator', re: /\bcalculators?\b/i },
  // An insulated soft lunch bag is the modern lunch box. Two of these are
  // named only "Lunch Bag Pink" in the `swig` (drinkware) category, so the
  // name is the only signal — a category-level deny on swig would lose them.
  { label: 'lunch-box', re: /\b(lunch ?box(es)?|lunch ?bags?|boxxi)\b/i },
  // Student backpacks and book bags qualify; framed packs and the excluded
  // bag types above are carved out by DENY.
  { label: 'backpack', re: /\b(backpacks?|book ?bags?|messenger bags?)\b/i },

  // --- clothing and footwear under $100 ---
  // A large real bucket here: Living Royal socks, Milkbarn pajamas, bamboo
  // newborn gown & hat sets. Household aprons are on the Comptroller's
  // qualifying clothing list.
  { label: 'clothing',
    re: /\b(socks?|pajamas?|pyjamas?|gowns?|onesies?|bodysuits?|bibs?|rompers?|shirts?|t-?shirts?|tees?|sweaters?|sweatshirts?|hoodies?|scarves|scarf|gloves?|mittens?|hats?|caps?|beanies?|robes?|dress(es)?|skirts?|pants?|shorts?|jackets?|coats?|leggings?|aprons?)\b/i },
  { label: 'footwear',
    re: /\b(shoes?|sandals?|boots?|slippers?|sneakers?|flip[- ]?flops?)\b/i },
];

// Real judgement calls. These land in their own bucket, default EXCLUDED, and
// get printed for a human to decide. The conservative direction is to keep
// charging tax: over-collecting is refundable to the customer, whereas
// under-collecting is a liability the shop pays out of margin.
export const AMBIGUOUS = [
  // Blank journals are functionally notebooks, but "journal" is not literally
  // on the Comptroller's list. 11 items, $10-$24.
  { label: 'journal', re: /\b(journals?|planners?|diar(y|ies))\b/i },
  // "Pencil boxes" is on the list; a zip pouch is arguably one — but "pouch"
  // also reads as a small handbag, which is excluded. ~20 items: Studio Oh!
  // Charmed Pencil Pouch ($27-30) and LUDDITE canvas pen cases ($18-44).
  // "Pencase" and "Pen Case" must classify identically; LUDDITE spells it
  // both ways within the same product line.
  { label: 'pencil-pouch', re: /\b(pencil|pen) ?(pouch(es)?|cases?|bags?)\b|\bpencases?\b/i },
  // A desk blotter is not a writing tablet — it only ever matched on "pad".
  { label: 'desk-pad', re: /\bdesk ?pads?\b/i },
  // Bare "paper" catches brand names as often as it catches loose-leaf.
  { label: 'bare-paper', re: /\bpapers?\b/i },
];

// Brand houses that stock nothing qualifying. Needed because in this catalog
// the category IS the brand, and some brands' product names are actively
// misleading: every "Notes & Queries" item is a greeting card, with names like
// "HB Multi Stars Paper Ros" that match on "Paper" and contain no "card".
export const DENY_CATEGORIES = new Set([
  'Notes & Queries', 'cardthartic', 'Quilling Card', 'jillson Roberts',
  'Roseanne Beck Collection', 'Pretty Simple', 'Kaleidoscope',
  'Julie Vos', 'Rain Jewelry', 'Rain', 'Splendid Iris', 'Queens Designs',
  'Brenda Grands', 'Ty', 'Voluspa', 'Beekman', 'Soap', 'Mixology',
  'Kohv Eyewear', 'Pampa Bay', 'Nordic Ware', "Fletchers' Mill", 'Tag',
  'Demdaco', 'House of Happy', 'Well Kept',
]);

// There is deliberately NO "this allow rule beats a category deny" escape.
// One was tried and it backfired twice in a single run: it let `Tag`'s
// "COWBOY BOOT TRINKET DISH" through as footwear, and `Ty`'s "EMMIE - chick w
// hat" through as clothing. The case it was meant to rescue — swig's "Lunch
// Bag Pink" — needs nothing, because swig is not a denied category. If a
// denied brand ever does stock something qualifying, add the exception for
// that one category rather than reopening a blanket bypass.

// Trade-SKU patterns beyond the shared set in catalog-filters.mjs. Kept local
// rather than pushed into the shared module so social grouping keeps behaving
// exactly as it does today. `\bassorted\b` already catches both real hits in
// the candidate set; these are belt-and-braces for the vendor pack notations
// that appear in this catalog.
export const TRADE_EXTRA = [/\b\d+\s*pcs?\b/i, /\bCDU\b/i, /\basmt\b/i];
export const isTradeExtra = name => TRADE_EXTRA.some(re => re.test(name));

const fires = (rule, hay) =>
  rule.re.test(hay) && !(rule.unless && rule.unless.test(hay));

// Verdicts:
//   'skip'      — not a candidate at all; nothing matched
//   'denied'    — looked like a candidate but an exclusion overruled it
//   'ambiguous' — needs a human call; excluded by default
//   'qualify'   — exempt
export function classify(item) {
  const hay = `${item.name} ${(item.categories || []).join(' ')}`;

  const allow = ALLOW.find(r => fires(r, hay));
  const ambiguous = AMBIGUOUS.find(r => fires(r, hay));
  if (!allow && !ambiguous) return { verdict: 'skip', rule: null };

  const deniedCategory = (item.categories || []).find(c => DENY_CATEGORIES.has(c));
  if (deniedCategory) {
    return {
      verdict: 'denied',
      rule: `category:${deniedCategory}`,
      overruled: (allow || ambiguous).label,
    };
  }

  const deny = DENY.find(r => fires(r, hay));
  if (deny) {
    return {
      verdict: 'denied',
      rule: deny.label,
      overruled: (allow || ambiguous).label,
    };
  }
  if (allow) return { verdict: 'qualify', rule: allow.label };
  return { verdict: 'ambiguous', rule: ambiguous.label };
}

// Under $100 per item, strictly. Square money is in cents.
export const THRESHOLD_CENTS = 100_00;

// The item-level API cannot exempt one variation and not another, so an item
// whose variations straddle $100 has no correct answer. Surface it instead of
// silently picking one.
export function priceCheck(item) {
  const cents = (item.variations || [])
    .map(v => v.priceCents)
    .filter(c => typeof c === 'number');
  if (!cents.length) return { ok: false, reason: 'no price', straddles: false };
  const max = Math.max(...cents);
  const min = Math.min(...cents);
  if (max >= THRESHOLD_CENTS) {
    return {
      ok: false,
      reason: `$${(max / 100).toFixed(2)} is not under $100`,
      straddles: min < THRESHOLD_CENTS,
      min, max,
    };
  }
  return { ok: true, straddles: false, min, max };
}
