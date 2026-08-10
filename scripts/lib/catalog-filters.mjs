// Filters shared by anything that reads the Square catalog and has to tell
// retail from trade.
//
// Extracted from group-catalog.mjs so tax-holiday.mjs can reuse it rather than
// keep a second copy that drifts. Two scripts disagreeing about what counts as
// a real product is exactly the kind of bug nobody notices until a $0.02
// counter display shows up in a customer-facing list.

// Retail-only. These are supplier pack, display and sample SKUs that live in
// the same catalog but are not things a customer can buy — posting
// "Set/24 Assorted bracelets, $3" or a "$0.02 FREE 12PC Counter Display"
// would be actively misleading.
export const TRADE_PATTERNS = [
  /\bset\/\d+/i,
  /pre-?pack/i,
  /\bdisplay\b/i,
  /\bfree\s*\d+\s*pc/i,
  /\bassorted\b/i,
  /\bMOQ\b/i,
  /\btester\b/i,
];

export const isTrade = name => TRADE_PATTERNS.some(re => re.test(name));
