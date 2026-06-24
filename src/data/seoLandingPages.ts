// Local SEO landing pages.
//
// Each entry becomes a statically-generated page at /<slug>. Copy is written to
// be unique per page (not templated boilerplate) so the pages earn their own
// rankings rather than reading as thin doorway pages. Shared store facts (NAP,
// hours) live in the template, not here.

export interface Highlight {
  title: string;
  body: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface SeoPage {
  slug: string;
  /** Grouping label shown in the eyebrow + used for related-link headings. */
  kind: 'Location' | 'Shop' | 'Brand';
  /** <title> — keep under ~60 chars before the brand suffix is added. */
  title: string;
  /** Meta description — aim for 140–160 chars. */
  description: string;
  /** Visible H1. */
  h1: string;
  /** Small uppercase label above the H1. */
  eyebrow: string;
  /** Lead paragraphs under the H1. */
  intro: string[];
  /** 3–4 supporting cards. */
  highlights: Highlight[];
  /** Optional brand chips to surface. */
  brands?: string[];
  /** Slugs of related landing pages to cross-link. */
  related: string[];
  /** Drives an FAQPage schema + an on-page accordion-free list. */
  faq: Faq[];
}

export const seoPages: SeoPage[] = [
  // ───────────────────────── Location pages ─────────────────────────
  {
    slug: 'gift-shop-terrell',
    kind: 'Location',
    title: 'Gift Shop in Terrell, TX',
    description:
      'Gugu Gifts is a curated gift shop in Terrell, TX at Tanger Outlets — candles, jewelry, home décor, local honey, and gift sets. Open Tue–Sun.',
    h1: 'A Curated Gift Shop in Terrell, Texas',
    eyebrow: 'Terrell, TX',
    intro: [
      'Gugu Gifts is a mid-luxe gift shop tucked inside Tanger Outlets in Terrell, Texas, in the former Claire’s space on Tanger Drive. We bring together beloved brands and locally made treasures so you can find something genuinely special without driving into Dallas.',
      'Whether you’re shopping for a birthday, a hostess gift, a wedding, or a little treat for yourself, our shelves are curated with intention — candles and home fragrance, designer and artisan jewelry, fine stationery, home décor, and Texas-made honey and soaps.',
    ],
    highlights: [
      { title: 'Easy to find off I-20', body: 'Right at Tanger Outlets in Terrell, an easy stop coming or going on I-20 and US-80 — plenty of parking.' },
      { title: 'Curated, not cluttered', body: 'Every item is hand-selected. You’ll see Voluspa, Julie Vos, Greenleaf, Swig, and one-of-a-kind local finds.' },
      { title: 'Gifts for every budget', body: 'From a $12 stocking stuffer to a showpiece statement necklace, there’s something at every price point.' },
      { title: 'Complimentary gift-ready feel', body: 'Beautiful packaging and a team that helps you put the perfect set together for any recipient.' },
    ],
    brands: ['Voluspa', 'Julie Vos', 'Rain', 'Greenleaf', 'Swig', 'Splendid Iris', 'Lucky Feather', 'Ty'],
    related: ['jewelry-terrell', 'candles-terrell', 'home-decor-terrell', 'gift-baskets-terrell'],
    faq: [
      { q: 'Where is Gugu Gifts located in Terrell?', a: 'We’re at 301 Tanger Dr, Suite 112, Terrell, TX 75160 — inside Tanger Outlets, in the former Claire’s location.' },
      { q: 'What are your store hours?', a: 'Tuesday through Saturday 10 AM–7 PM, Sunday 11 AM–6 PM, and closed Mondays.' },
      { q: 'What kind of gifts do you carry?', a: 'Candles and home fragrance, designer and artisan jewelry, fine stationery, home décor, local honey and soaps, and ready-to-give curated gift sets.' },
    ],
  },
  {
    slug: 'gift-shop-forney',
    kind: 'Location',
    title: 'Gift Shop Near Forney, TX',
    description:
      'Looking for a gift shop near Forney, TX? Gugu Gifts at Tanger Outlets in Terrell is a short drive east — candles, jewelry, décor, and curated gift sets.',
    h1: 'A Gift Shop Worth the Short Drive from Forney',
    eyebrow: 'Near Forney, TX',
    intro: [
      'Forney neighbors don’t have to settle for big-box gift aisles. Gugu Gifts is just east on US-80 at Tanger Outlets in Terrell — a quick, traffic-free trip for a curated gift shop with personality.',
      'We stock the kind of gifts that feel hand-picked: luxury candles, designer jewelry, Texas honey, and beautifully assembled gift sets. It’s an easy detour for a birthday present, a housewarming gift for a new Forney build, or a treat for yourself.',
    ],
    highlights: [
      { title: 'A quick hop east on US-80', body: 'About 15 minutes from Forney — far less hassle than fighting traffic toward Dallas for a gift.' },
      { title: 'Housewarming-ready', body: 'New build in Devonshire, Gateway Parks, or Travis Ranch? We’ll help you pull together a gift that feels like home.' },
      { title: 'Local and luxe', body: 'Greenleaf and Voluspa candles next to Texas-made honey and artisan soaps — familiar names and local finds together.' },
    ],
    brands: ['Voluspa', 'Greenleaf', 'Julie Vos', 'Swig'],
    related: ['gift-shop-terrell', 'candles-terrell', 'gift-baskets-terrell', 'gift-shop-mesquite'],
    faq: [
      { q: 'How far is Gugu Gifts from Forney?', a: 'Roughly 15 minutes east via US-80 to Tanger Outlets in Terrell, at 301 Tanger Dr, Suite 112.' },
      { q: 'Do you have housewarming gifts for new Forney homes?', a: 'Yes — candles, diffusers, décor, and curated gift sets make easy housewarming and new-build gifts.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'gift-shop-kaufman',
    kind: 'Location',
    title: 'Gift Shop Near Kaufman, TX',
    description:
      'A curated gift shop near Kaufman, TX. Gugu Gifts at Tanger Outlets in Terrell carries candles, jewelry, home décor, and local Texas honey — open Tue–Sun.',
    h1: 'Your Nearby Gift Shop, Just North of Kaufman',
    eyebrow: 'Near Kaufman, TX',
    intro: [
      'For Kaufman County shoppers, Gugu Gifts is the curated gift shop you’ve been driving past the chains to find. We’re a short trip north in Terrell at Tanger Outlets, with gifts you won’t see everywhere else.',
      'As a Kaufman County neighbor ourselves, we love stocking Texas-made honey, soaps, and crafts alongside well-loved brands like Voluspa and Julie Vos — so you can support local and still grab that perfect designer piece.',
    ],
    highlights: [
      { title: 'Close to home', body: 'About 15 minutes from Kaufman — an easy errand for a thoughtful gift instead of a generic one.' },
      { title: 'Proudly Kaufman County', body: 'We feature local honey and artisan goods from right here in the area.' },
      { title: 'For every occasion', body: 'Birthdays, weddings, teacher gifts, thank-yous — we’ll help you find exactly the right thing.' },
    ],
    brands: ['Voluspa', 'Julie Vos', 'Greenleaf', 'Lucky Feather'],
    related: ['gift-shop-terrell', 'local-honey-terrell', 'jewelry-terrell', 'candles-terrell'],
    faq: [
      { q: 'How far is Gugu Gifts from Kaufman?', a: 'About 15 minutes north to Tanger Outlets in Terrell, at 301 Tanger Dr, Suite 112.' },
      { q: 'Do you carry local Texas products?', a: 'Yes — we stock local honey, handmade soaps, and artisan crafts alongside our curated brands.' },
      { q: 'What are your hours?', a: 'Tuesday–Saturday 10 AM–7 PM, Sunday 11 AM–6 PM, closed Mondays.' },
    ],
  },
  {
    slug: 'gift-shop-rockwall',
    kind: 'Location',
    title: 'Gift Shop Near Rockwall, TX',
    description:
      'A curated gift shop near Rockwall, TX. Gugu Gifts at Tanger Outlets in Terrell offers luxury candles, designer jewelry, décor, and gift sets worth the drive.',
    h1: 'A Curated Gift Shop a Short Drive South of Rockwall',
    eyebrow: 'Near Rockwall, TX',
    intro: [
      'Rockwall shoppers who appreciate a beautifully curated store will feel right at home at Gugu Gifts. We’re just south at Tanger Outlets in Terrell, pairing designer brands with local Texas treasures.',
      'Make a morning of it: browse luxury candles, try on Julie Vos and Lucky Feather jewelry, and pick up a gift set that looks like it took far more effort than it did.',
    ],
    highlights: [
      { title: 'Worth the trip', body: 'About 25 minutes from Rockwall — and the curation makes it worth every minute.' },
      { title: 'Designer + artisan', body: 'Julie Vos and Voluspa beside Texas-made honey and soaps — high-low done tastefully.' },
      { title: 'Gift-ready in minutes', body: 'Tell us the recipient and the budget; we’ll build a gift that wows.' },
    ],
    brands: ['Julie Vos', 'Voluspa', 'Lucky Feather', 'Swig'],
    related: ['gift-shop-terrell', 'jewelry-terrell', 'candles-terrell', 'gift-baskets-terrell'],
    faq: [
      { q: 'How far is Gugu Gifts from Rockwall?', a: 'Roughly 25 minutes south to Tanger Outlets in Terrell, at 301 Tanger Dr, Suite 112.' },
      { q: 'Do you carry Julie Vos jewelry?', a: 'Yes — we carry Julie Vos along with Lucky Feather and other designer and artisan jewelry.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'gift-shop-mesquite',
    kind: 'Location',
    title: 'Gift Shop Near Mesquite, TX',
    description:
      'A curated gift shop near Mesquite, TX. Gugu Gifts at Tanger Outlets in Terrell carries candles, jewelry, home décor, and local honey — an easy stop off I-20.',
    h1: 'A Curated Gift Shop Just East of Mesquite',
    eyebrow: 'Near Mesquite, TX',
    intro: [
      'Skip the crowded mall. Gugu Gifts is an easy drive east of Mesquite on I-20, at Tanger Outlets in Terrell, with a curated mix you won’t find in the big chains.',
      'From luxury candles and designer jewelry to Texas honey and ready-to-give gift sets, we make it simple to grab something memorable on your way through.',
    ],
    highlights: [
      { title: 'Straight down I-20', body: 'About 20 minutes east of Mesquite with easy parking right at Tanger Outlets.' },
      { title: 'Better than the mall', body: 'Curated brands and local makers instead of the same big-box gift aisle.' },
      { title: 'Quick, thoughtful gifts', body: 'In and out with a present that actually feels considered — even last minute.' },
    ],
    brands: ['Voluspa', 'Greenleaf', 'Swig', 'Splendid Iris'],
    related: ['gift-shop-terrell', 'candles-terrell', 'home-decor-terrell', 'gift-shop-forney'],
    faq: [
      { q: 'How far is Gugu Gifts from Mesquite?', a: 'About 20 minutes east on I-20 to Tanger Outlets in Terrell, at 301 Tanger Dr, Suite 112.' },
      { q: 'Is there parking?', a: 'Yes — there’s ample free parking at Tanger Outlets right by the store.' },
      { q: 'What are your hours?', a: 'Tuesday–Saturday 10 AM–7 PM, Sunday 11 AM–6 PM, closed Mondays.' },
    ],
  },

  // ───────────────────────── Shop / category pages ─────────────────────────
  {
    slug: 'jewelry-terrell',
    kind: 'Shop',
    title: 'Jewelry in Terrell, TX',
    description:
      'Shop designer and artisan jewelry in Terrell, TX at Gugu Gifts — Julie Vos, Lucky Feather, and more. Necklaces, earrings, and bracelets for every occasion.',
    h1: 'Designer & Artisan Jewelry in Terrell',
    eyebrow: 'Jewelry · Terrell, TX',
    intro: [
      'Looking for jewelry in Terrell that feels special? Gugu Gifts carries a thoughtfully chosen selection of designer and artisan pieces — from everyday gold-tone staples to statement necklaces that finish an outfit.',
      'Our jewelry lineup includes Julie Vos, known for its 24k gold-plated heirloom-style designs, and Lucky Feather, with meaningful pieces that make heartfelt gifts. Stop in to try things on and find the piece that’s unmistakably you.',
    ],
    highlights: [
      { title: 'Julie Vos', body: 'Timeless, 24k gold-plated designs with a vintage-inspired feel — beloved for gifting and treating yourself.' },
      { title: 'Lucky Feather', body: 'Meaningful, message-driven jewelry that’s perfect for birthdays, graduations, and thank-yous.' },
      { title: 'For every occasion', body: 'Necklaces, earrings, bracelets, and rings across price points — from everyday to special-occasion.' },
      { title: 'Try before you buy', body: 'See the pieces in person, compare finishes, and get help choosing the right gift.' },
    ],
    brands: ['Julie Vos', 'Rain', 'Lucky Feather'],
    related: ['julie-vos-jewelry-terrell', 'rain-jewelry-terrell', 'lucky-feather-jewelry-terrell', 'gift-shop-terrell'],
    faq: [
      { q: 'Do you carry Julie Vos in Terrell?', a: 'Yes — Gugu Gifts carries Julie Vos jewelry at our store in Tanger Outlets, Terrell.' },
      { q: 'What jewelry brands do you sell?', a: 'We carry Julie Vos and Lucky Feather, plus artisan pieces, with new styles arriving regularly.' },
      { q: 'Do you have jewelry gifts for special occasions?', a: 'Absolutely — we’ll help you choose a piece and make it gift-ready for birthdays, weddings, and more.' },
    ],
  },
  {
    slug: 'candles-terrell',
    kind: 'Shop',
    title: 'Candles in Terrell, TX',
    description:
      'Shop luxury candles in Terrell, TX at Gugu Gifts — Voluspa, Greenleaf, and Splendid Iris. Home fragrance, diffusers, and room sprays that make perfect gifts.',
    h1: 'Luxury Candles & Home Fragrance in Terrell',
    eyebrow: 'Candles · Terrell, TX',
    intro: [
      'If you’re hunting for candles in Terrell, Gugu Gifts is your spot for the good stuff. We carry premium home-fragrance brands that fill a room beautifully and make reliably crowd-pleasing gifts.',
      'Find Voluspa’s coconut-wax candles in their signature embossed glass, Greenleaf’s flameless diffusers and sachets, and Splendid Iris artisan candles. Come smell them in person and pick your new signature scent.',
    ],
    highlights: [
      { title: 'Voluspa', body: 'Coconut-wax candles with clean, long burns and that instantly recognizable embossed glass.' },
      { title: 'Greenleaf', body: 'Flower diffusers, sachets, and room sprays for fragrance without a flame.' },
      { title: 'Splendid Iris', body: 'Artisan candles and gift-worthy scents you won’t find at the grocery store.' },
      { title: 'Smell before you buy', body: 'Test scents in person to find the one that suits the room — or the recipient.' },
    ],
    brands: ['Voluspa', 'Greenleaf', 'Splendid Iris'],
    related: ['voluspa-candles-terrell', 'greenleaf-terrell', 'splendid-iris-terrell', 'home-decor-terrell'],
    faq: [
      { q: 'Do you sell Voluspa candles in Terrell?', a: 'Yes — Voluspa is one of our signature candle lines, available at our Tanger Outlets store in Terrell.' },
      { q: 'What candle brands do you carry?', a: 'Voluspa, Greenleaf home fragrance, and Splendid Iris artisan candles, among others.' },
      { q: 'Do you have flameless options?', a: 'Yes — Greenleaf flower diffusers, sachets, and room sprays offer fragrance without an open flame.' },
    ],
  },
  {
    slug: 'home-decor-terrell',
    kind: 'Shop',
    title: 'Home Décor in Terrell, TX',
    description:
      'Shop home décor in Terrell, TX at Gugu Gifts — elegant vases, accent pieces, diffusers, and gift-worthy finds to bring warmth to any space.',
    h1: 'Home Décor & Accent Pieces in Terrell',
    eyebrow: 'Home Décor · Terrell, TX',
    intro: [
      'Gugu Gifts brings a curated take on home décor to Terrell — elegant, gift-worthy pieces that add warmth and personality without feeling mass-produced.',
      'Browse vases, accent pieces, decorative trays, diffusers, and seasonal touches that work as a treat for your own space or a polished housewarming gift. It all pairs beautifully with our candles and home fragrance.',
    ],
    highlights: [
      { title: 'Curated accents', body: 'Vases, trays, and decorative objects chosen to elevate a shelf, mantel, or entryway.' },
      { title: 'Fragrance + décor', body: 'Greenleaf diffusers and Voluspa candles that double as design pieces.' },
      { title: 'Housewarming-ready', body: 'Pieces that make thoughtful new-home and hostess gifts, gift-wrapped on request.' },
    ],
    brands: ['Greenleaf', 'Voluspa'],
    related: ['gift-shop-terrell', 'candles-terrell', 'gift-baskets-terrell', 'local-honey-terrell'],
    faq: [
      { q: 'What home décor do you carry?', a: 'Vases, accent pieces, trays, diffusers, and seasonal décor — curated to feel special, not mass-produced.' },
      { q: 'Do you have housewarming gifts?', a: 'Yes — décor, candles, and curated gift sets all make great housewarming and hostess gifts.' },
      { q: 'Where are you located?', a: 'At Tanger Outlets, 301 Tanger Dr, Suite 112, Terrell, TX 75160.' },
    ],
  },
  {
    slug: 'fine-stationery-terrell',
    kind: 'Shop',
    title: 'Fine Stationery & Pens in Terrell, TX',
    description:
      'Shop fine stationery and pens in Terrell, TX at Gugu Gifts — Kaweco fountain pens, journals, and premium paper goods that make memorable gifts.',
    h1: 'Fine Stationery & Pens in Terrell',
    eyebrow: 'Stationery · Terrell, TX',
    intro: [
      'For anyone who still loves putting pen to paper, Gugu Gifts offers a curated selection of fine stationery in Terrell — premium pens, journals, and paper goods that feel like a small luxury.',
      'Our standout is Kaweco, the German maker of pocket-sized fountain and ballpoint pens prized by writers, students, and collectors. Pair a pen with a journal for a gift that’s both practical and thoughtful.',
    ],
    highlights: [
      { title: 'Kaweco pens', body: 'Iconic compact fountain and ballpoint pens — a beloved gift for writers and design lovers.' },
      { title: 'Journals & paper goods', body: 'Notebooks and stationery that make everyday writing feel a little more special.' },
      { title: 'Gift-ready pairings', body: 'Combine a pen and journal into a polished gift set in minutes.' },
    ],
    brands: ['Kaweco'],
    related: ['kaweco-pens-terrell', 'gift-shop-terrell', 'gift-baskets-terrell', 'jewelry-terrell'],
    faq: [
      { q: 'Do you carry Kaweco pens in Terrell?', a: 'Yes — Kaweco fountain and ballpoint pens are part of our stationery selection at the Terrell store.' },
      { q: 'Do you have journals and notebooks?', a: 'Yes — we carry journals and premium paper goods that pair perfectly with our pens.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'local-honey-terrell',
    kind: 'Shop',
    title: 'Local Honey & Artisan Goods in Terrell, TX',
    description:
      'Shop local Texas honey and artisan goods in Terrell, TX at Gugu Gifts — farm-fresh honey, handmade soaps, and crafts from Valley Orchid Farms and local makers.',
    h1: 'Local Honey & Texas Artisan Goods in Terrell',
    eyebrow: 'Local & Artisan · Terrell, TX',
    intro: [
      'Gugu Gifts was born from Valley Orchid Farms in Canton, Texas — so local honey and artisan goods are close to our heart. In Terrell, you’ll find farm-fresh honey, handmade soaps, and crafts from makers around the region.',
      'These are the gifts that feel personal and rooted in place: a jar of Texas honey, a hand-poured soap, a small-batch craft. Perfect for visitors wanting a taste of local, or anyone who values supporting nearby makers.',
    ],
    highlights: [
      { title: 'Farm-fresh honey', body: 'Texas honey with roots at Valley Orchid Farms — a sweet, local gift or pantry staple.' },
      { title: 'Handmade soaps', body: 'Small-batch soaps and bath goods from regional artisans.' },
      { title: 'Support local makers', body: 'Crafts and goods from around Kaufman County and East Texas.' },
    ],
    brands: ['Local Artisans'],
    related: ['gift-shop-terrell', 'gift-baskets-terrell', 'home-decor-terrell', 'gift-shop-kaufman'],
    faq: [
      { q: 'Do you sell local Texas honey?', a: 'Yes — we carry farm-fresh local honey with roots at Valley Orchid Farms in Canton, Texas.' },
      { q: 'What other local goods do you have?', a: 'Handmade soaps, bath goods, and artisan crafts from makers around the region.' },
      { q: 'Where are you located?', a: 'Tanger Outlets, 301 Tanger Dr, Suite 112, Terrell, TX 75160.' },
    ],
  },
  {
    slug: 'gift-baskets-terrell',
    kind: 'Shop',
    title: 'Gift Baskets & Gift Sets in Terrell, TX',
    description:
      'Curated gift baskets and gift sets in Terrell, TX at Gugu Gifts — beautifully assembled for birthdays, hostess gifts, thank-yous, and every occasion.',
    h1: 'Curated Gift Baskets & Gift Sets in Terrell',
    eyebrow: 'Gift Sets · Terrell, TX',
    intro: [
      'Short on time but want a gift that wows? Gugu Gifts assembles curated gift baskets and gift sets in Terrell — beautifully put together from our candles, jewelry, honey, and décor.',
      'Tell us the recipient, the occasion, and the budget, and we’ll build a set that looks like you spent hours on it. Great for hostess gifts, thank-yous, birthdays, new homes, and corporate gifting.',
    ],
    highlights: [
      { title: 'Built around you', body: 'We mix and match candles, jewelry, honey, and more to suit the recipient and budget.' },
      { title: 'Occasion-ready', body: 'Hostess gifts, thank-yous, birthdays, welcome gifts, and corporate orders.' },
      { title: 'Beautifully presented', body: 'Thoughtful packaging that makes the gift feel as good as it looks.' },
    ],
    brands: ['Voluspa', 'Greenleaf', 'Julie Vos', 'Local Artisans'],
    related: ['gift-shop-terrell', 'candles-terrell', 'jewelry-terrell', 'local-honey-terrell'],
    faq: [
      { q: 'Do you make custom gift baskets?', a: 'Yes — tell us the occasion and budget and we’ll assemble a curated gift set from our products.' },
      { q: 'Can you do corporate or bulk gifting?', a: 'We’re happy to help with multiple or corporate gift sets — stop in or email us to plan.' },
      { q: 'What are your hours?', a: 'Tuesday–Saturday 10 AM–7 PM, Sunday 11 AM–6 PM, closed Mondays.' },
    ],
  },

  // ───────────────────────── Brand pages ─────────────────────────
  {
    slug: 'voluspa-candles-terrell',
    kind: 'Brand',
    title: 'Voluspa Candles in Terrell, TX',
    description:
      'Shop Voluspa candles in Terrell, TX at Gugu Gifts. Coconut-wax candles in signature embossed glass — find your scent in person at Tanger Outlets.',
    h1: 'Voluspa Candles in Terrell',
    eyebrow: 'Voluspa · Terrell, TX',
    intro: [
      'Gugu Gifts carries Voluspa candles in Terrell, so you can shop the brand’s coconut-wax candles and home fragrance in person rather than guessing online. Come smell the scents and find your favorite.',
      'Voluspa is loved for its clean, long-burning coconut-wax blends and beautiful embossed glassware that looks gorgeous long after the candle’s done. They make a reliably impressive gift — or a well-earned treat.',
    ],
    highlights: [
      { title: 'Coconut-wax burn', body: 'Clean, even, long-lasting burns that throw fragrance beautifully across a room.' },
      { title: 'Signature glassware', body: 'Embossed jars and tins that double as décor once the candle’s finished.' },
      { title: 'Smell them in person', body: 'Test the scents in-store to find the one that fits your space or your gift.' },
    ],
    brands: ['Voluspa'],
    related: ['candles-terrell', 'gift-shop-terrell', 'home-decor-terrell', 'gift-baskets-terrell'],
    faq: [
      { q: 'Do you sell Voluspa candles in Terrell?', a: 'Yes — Voluspa is one of our signature candle lines at Gugu Gifts in Tanger Outlets, Terrell.' },
      { q: 'Can I smell the scents before buying?', a: 'Absolutely — come test the Voluspa scents in person to find your favorite.' },
      { q: 'Where are you located?', a: '301 Tanger Dr, Suite 112, Terrell, TX 75160, inside Tanger Outlets.' },
    ],
  },
  {
    slug: 'julie-vos-jewelry-terrell',
    kind: 'Brand',
    title: 'Julie Vos Jewelry in Terrell, TX',
    description:
      'Shop Julie Vos jewelry in Terrell, TX at Gugu Gifts. 24k gold-plated, heirloom-inspired necklaces, bracelets, and earrings — try them on at Tanger Outlets.',
    h1: 'Julie Vos Jewelry in Terrell',
    eyebrow: 'Julie Vos · Terrell, TX',
    intro: [
      'Gugu Gifts is your local source for Julie Vos jewelry in Terrell. Try on the brand’s instantly recognizable 24k gold-plated designs in person and see the finishes and stones up close.',
      'Julie Vos pieces have a vintage, heirloom-inspired feel that dresses up everyday outfits and makes a memorable gift. From bangles to statement necklaces, we’ll help you find the piece that feels just right.',
    ],
    highlights: [
      { title: '24k gold-plated', body: 'Rich, heirloom-style finishes designed to be worn and loved for years.' },
      { title: 'Vintage-inspired design', body: 'Timeless silhouettes — bangles, earrings, and statement necklaces.' },
      { title: 'Try it on in person', body: 'See how each piece sits and pairs before you buy or gift it.' },
    ],
    brands: ['Julie Vos'],
    related: ['jewelry-terrell', 'gift-shop-terrell', 'gift-baskets-terrell', 'candles-terrell'],
    faq: [
      { q: 'Do you carry Julie Vos in Terrell?', a: 'Yes — Gugu Gifts carries Julie Vos jewelry at our store in Tanger Outlets, Terrell.' },
      { q: 'Can I try Julie Vos pieces on?', a: 'Yes — come in to try on bangles, earrings, and necklaces and compare finishes.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'rain-jewelry-terrell',
    kind: 'Brand',
    title: 'Rain Jewelry in Terrell, TX',
    description:
      'Shop Rain jewelry in Terrell, TX at Gugu Gifts. Lightweight, gold-dipped statement necklaces, earrings, and bracelets — try them on at Tanger Outlets.',
    h1: 'Rain Jewelry in Terrell',
    eyebrow: 'Rain · Terrell, TX',
    intro: [
      'Gugu Gifts carries Rain jewelry in Terrell — the go-to line for lightweight, gold-dipped pieces that make a statement without weighing you down. Come see the colors and finishes in person.',
      'Rain is loved for its layered necklaces, druzy and semi-precious accents, and easy-to-wear earrings that dress up jeans or an evening look just the same. At approachable price points, it’s a favorite for gifting and self-treats alike.',
    ],
    highlights: [
      { title: 'Feather-light to wear', body: 'Statement looks you’ll actually keep on all day — Rain is known for how light it feels.' },
      { title: 'Gold-dipped finishes', body: 'Warm, layered designs with druzy and semi-precious accents that catch the light.' },
      { title: 'Easy to gift', body: 'Approachable prices and crowd-pleasing styles make Rain a reliable go-to gift.' },
    ],
    brands: ['Rain'],
    related: ['jewelry-terrell', 'julie-vos-jewelry-terrell', 'lucky-feather-jewelry-terrell', 'gift-shop-terrell'],
    faq: [
      { q: 'Do you carry Rain jewelry in Terrell?', a: 'Yes — Gugu Gifts carries Rain jewelry at our store in Tanger Outlets, Terrell.' },
      { q: 'Is Rain jewelry lightweight?', a: 'Yes — Rain is known for statement designs that stay comfortable and light to wear all day.' },
      { q: 'Where are you located?', a: '301 Tanger Dr, Suite 112, Terrell, TX 75160, inside Tanger Outlets.' },
    ],
  },
  {
    slug: 'lucky-feather-jewelry-terrell',
    kind: 'Brand',
    title: 'Lucky Feather Jewelry in Terrell, TX',
    description:
      'Shop Lucky Feather jewelry in Terrell, TX at Gugu Gifts. Meaningful, message-driven necklaces and earrings that make heartfelt, affordable gifts.',
    h1: 'Lucky Feather Jewelry in Terrell',
    eyebrow: 'Lucky Feather · Terrell, TX',
    intro: [
      'Gugu Gifts carries Lucky Feather jewelry in Terrell — delicate, meaningful pieces designed to be given. Each style pairs a pretty, wearable design with a message that makes it feel personal.',
      'From birthday and graduation pieces to “just because” gifts for a friend, Lucky Feather is affordable, sweet, and ready to give. It’s one of the easiest ways to turn a small gesture into a memorable one.',
    ],
    highlights: [
      { title: 'Gifts with meaning', body: 'Message-driven designs for birthdays, graduations, friendships, and milestones.' },
      { title: 'Dainty and wearable', body: 'Delicate gold-tone styles that layer well and suit everyday wear.' },
      { title: 'Easy on the budget', body: 'Thoughtful, giftable pieces at a friendly price point.' },
    ],
    brands: ['Lucky Feather'],
    related: ['jewelry-terrell', 'rain-jewelry-terrell', 'julie-vos-jewelry-terrell', 'gift-baskets-terrell'],
    faq: [
      { q: 'Do you carry Lucky Feather in Terrell?', a: 'Yes — Lucky Feather jewelry is part of our selection at Gugu Gifts in Tanger Outlets, Terrell.' },
      { q: 'Is Lucky Feather good for gifts?', a: 'Yes — its meaningful, message-based designs make heartfelt and affordable gifts.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'greenleaf-terrell',
    kind: 'Brand',
    title: 'Greenleaf Home Fragrance in Terrell, TX',
    description:
      'Shop Greenleaf home fragrance in Terrell, TX at Gugu Gifts. Flower diffusers, sachets, candles, and room sprays — flameless fragrance for any space.',
    h1: 'Greenleaf Home Fragrance in Terrell',
    eyebrow: 'Greenleaf · Terrell, TX',
    intro: [
      'Gugu Gifts carries Greenleaf home fragrance in Terrell, including the brand’s signature Flower Diffusers, sachets, candles, and room sprays. Come find a scent that makes your home feel like home.',
      'Greenleaf is a favorite for flameless fragrance — slip a sachet in a drawer, set out a flower diffuser, or freshen a room with a spritz. The scents are beautifully blended and make easy, welcome gifts.',
    ],
    highlights: [
      { title: 'Signature Flower Diffusers', body: 'Greenleaf’s iconic paper-flower diffusers — fragrance and décor in one, no flame needed.' },
      { title: 'Sachets & room sprays', body: 'Freshen drawers, closets, and cars, or mist a room in seconds.' },
      { title: 'Giftable scents', body: 'Beautifully blended fragrances that make easy hostess and thank-you gifts.' },
    ],
    brands: ['Greenleaf'],
    related: ['candles-terrell', 'home-decor-terrell', 'splendid-iris-terrell', 'gift-shop-terrell'],
    faq: [
      { q: 'Do you carry Greenleaf in Terrell?', a: 'Yes — Greenleaf home fragrance, including the Flower Diffusers, is available at our Terrell store.' },
      { q: 'What is a Greenleaf Flower Diffuser?', a: 'It’s a decorative paper flower that draws up scented oil to fragrance a room without a flame.' },
      { q: 'Where are you located?', a: 'Tanger Outlets, 301 Tanger Dr, Suite 112, Terrell, TX 75160.' },
    ],
  },
  {
    slug: 'splendid-iris-terrell',
    kind: 'Brand',
    title: 'Splendid Iris in Terrell, TX',
    description:
      'Shop Splendid Iris candles and gifts in Terrell, TX at Gugu Gifts. Artisan candles and gift-worthy scents you won’t find at the grocery store.',
    h1: 'Splendid Iris Candles & Gifts in Terrell',
    eyebrow: 'Splendid Iris · Terrell, TX',
    intro: [
      'Gugu Gifts carries Splendid Iris in Terrell — artisan candles and gifts with character you won’t find on a grocery-store shelf. Stop in to discover a new favorite scent.',
      'Splendid Iris pieces are made to be gifted and displayed, pairing thoughtful fragrance with charming presentation. They sit right at home next to our Voluspa and Greenleaf lines.',
    ],
    highlights: [
      { title: 'Artisan candles', body: 'Small-batch character and fragrances that stand apart from mass-market candles.' },
      { title: 'Made to gift', body: 'Charming presentation that looks as good as it smells — gift-ready as-is.' },
      { title: 'Pairs beautifully', body: 'Mix with Voluspa or Greenleaf for a layered home-fragrance gift set.' },
    ],
    brands: ['Splendid Iris'],
    related: ['candles-terrell', 'greenleaf-terrell', 'voluspa-candles-terrell', 'gift-baskets-terrell'],
    faq: [
      { q: 'Do you carry Splendid Iris in Terrell?', a: 'Yes — Splendid Iris artisan candles and gifts are part of our selection in Terrell.' },
      { q: 'Are Splendid Iris candles good gifts?', a: 'Yes — their fragrance and presentation make them gift-ready right off the shelf.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'swig-drinkware-terrell',
    kind: 'Brand',
    title: 'Swig Drinkware in Terrell, TX',
    description:
      'Shop Swig drinkware in Terrell, TX at Gugu Gifts. Insulated stainless-steel tumblers, cups, and can coolers in bold patterns — perfect everyday gifts.',
    h1: 'Swig Drinkware in Terrell',
    eyebrow: 'Swig · Terrell, TX',
    intro: [
      'Gugu Gifts carries Swig drinkware in Terrell — the colorful, insulated tumblers, cups, and can coolers that keep drinks cold for hours and hot ones hot. Come pick your pattern.',
      'Swig’s triple-insulated stainless steel and bold prints have made it a runaway favorite for gifting, teacher appreciation, bridal parties, and everyday use. Grab one for yourself and a few to give.',
    ],
    highlights: [
      { title: 'Keeps drinks cold for hours', body: 'Triple-insulated stainless steel that holds temperature far longer than a basic cup.' },
      { title: 'Bold, fun patterns', body: 'Eye-catching prints and colors that make Swig instantly recognizable.' },
      { title: 'Gift in multiples', body: 'A go-to for teacher gifts, bridal parties, and stocking stuffers.' },
    ],
    brands: ['Swig'],
    related: ['gift-shop-terrell', 'gift-baskets-terrell', 'home-decor-terrell', 'candles-terrell'],
    faq: [
      { q: 'Do you sell Swig cups in Terrell?', a: 'Yes — Swig tumblers, cups, and can coolers are available at Gugu Gifts in Tanger Outlets, Terrell.' },
      { q: 'Do Swig tumblers keep drinks cold?', a: 'Yes — they’re triple-insulated stainless steel and keep cold drinks cold and hot drinks hot for hours.' },
      { q: 'Where are you located?', a: '301 Tanger Dr, Suite 112, Terrell, TX 75160.' },
    ],
  },
  {
    slug: 'kaweco-pens-terrell',
    kind: 'Brand',
    title: 'Kaweco Pens in Terrell, TX',
    description:
      'Shop Kaweco pens in Terrell, TX at Gugu Gifts. Iconic German pocket fountain and ballpoint pens — a memorable gift for writers and design lovers.',
    h1: 'Kaweco Pens in Terrell',
    eyebrow: 'Kaweco · Terrell, TX',
    intro: [
      'Gugu Gifts carries Kaweco pens in Terrell — the German-made pocket fountain and ballpoint pens prized by writers, students, and collectors. See the iconic Sport in person and find your nib.',
      'Compact when closed and full-size when posted, Kaweco pens are as practical as they are handsome. Pair one with a journal for a gift that feels considered and lasts for years.',
    ],
    highlights: [
      { title: 'The iconic Sport', body: 'Pocket-sized when closed, full-length when posted — a design classic since the 1930s.' },
      { title: 'Fountain & ballpoint', body: 'Smooth writers in a range of finishes for everyday carry or gifting.' },
      { title: 'Pairs with a journal', body: 'Add a notebook for a polished, ready-to-give stationery set.' },
    ],
    brands: ['Kaweco'],
    related: ['fine-stationery-terrell', 'gift-shop-terrell', 'gift-baskets-terrell', 'jewelry-terrell'],
    faq: [
      { q: 'Do you carry Kaweco pens in Terrell?', a: 'Yes — Kaweco fountain and ballpoint pens are part of our stationery selection in Terrell.' },
      { q: 'Are Kaweco pens good gifts?', a: 'Yes — they’re a beloved gift for writers and design lovers, especially paired with a journal.' },
      { q: 'When are you open?', a: 'Tue–Sat 10 AM–7 PM, Sun 11 AM–6 PM, closed Monday.' },
    ],
  },
  {
    slug: 'ty-beanie-babies-terrell',
    kind: 'Brand',
    title: 'Ty Beanie Babies & Plush in Terrell, TX',
    description:
      'Shop Ty Beanie Babies and Beanie Boos in Terrell, TX at Gugu Gifts. Soft, collectible plush toys kids love — perfect birthday and just-because gifts.',
    h1: 'Ty Beanie Babies & Plush in Terrell',
    eyebrow: 'Ty · Terrell, TX',
    intro: [
      'Gugu Gifts carries Ty plush in Terrell — including the beloved Beanie Babies and big-eyed Beanie Boos that kids (and collectors) adore. Come pick out a new cuddly friend.',
      'Soft, huggable, and endlessly collectible, Ty plush make easy birthday, get-well, and just-because gifts. Add one to a gift set or let a little one choose their favorite in person.',
    ],
    highlights: [
      { title: 'Beanie Boos & Beanie Babies', body: 'The big-eyed Boos and the classic Beanie Babies kids love to collect.' },
      { title: 'Soft and huggable', body: 'Cuddly plush that makes a reliable birthday, get-well, or new-baby gift.' },
      { title: 'Add to any gift set', body: 'Tuck a plush friend into a curated gift basket for an extra-sweet touch.' },
    ],
    brands: ['Ty'],
    related: ['gift-shop-terrell', 'gift-baskets-terrell', 'home-decor-terrell', 'gift-shop-forney'],
    faq: [
      { q: 'Do you sell Ty Beanie Babies in Terrell?', a: 'Yes — Gugu Gifts carries Ty plush, including Beanie Babies and Beanie Boos, at our Terrell store.' },
      { q: 'Are Ty plush good for kids?', a: 'Yes — they’re soft, huggable, and collectible, making great birthday and just-because gifts.' },
      { q: 'Where are you located?', a: 'Tanger Outlets, 301 Tanger Dr, Suite 112, Terrell, TX 75160.' },
    ],
  },
];

export function getPage(slug: string): SeoPage | undefined {
  return seoPages.find((p) => p.slug === slug);
}
