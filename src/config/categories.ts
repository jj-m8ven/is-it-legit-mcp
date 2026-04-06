// Seed category data — mirrors what's in migration 026
// Used for query parsing and fuzzy matching

export interface CategoryDef {
  slug: string
  name: string
  children?: CategoryDef[]
  keywords?: string[] // Additional keywords that map to this category
}

export const CATEGORY_TREE: CategoryDef[] = [
  {
    slug: 'electronics',
    name: 'Electronics',
    keywords: ['tech', 'electronic', 'gadget', 'device'],
    children: [
      { slug: 'phones', name: 'Phones', keywords: ['phone', 'iphone', 'android', 'smartphone', 'cell', 'mobile'] },
      { slug: 'laptops', name: 'Laptops', keywords: ['laptop', 'macbook', 'computer', 'notebook', 'pc'] },
      { slug: 'gaming', name: 'Gaming', keywords: ['gaming', 'console', 'playstation', 'xbox', 'nintendo', 'switch', 'ps5'] },
      { slug: 'audio', name: 'Audio', keywords: ['audio', 'headphones', 'speakers', 'earbuds', 'airpods', 'soundbar'] },
    ],
  },
  {
    slug: 'clothing',
    name: 'Clothing',
    keywords: ['clothes', 'apparel', 'fashion', 'wear'],
    children: [
      { slug: 'sneakers', name: 'Sneakers', keywords: ['sneaker', 'shoe', 'jordan', 'nike', 'yeezy', 'kicks'] },
      { slug: 'streetwear', name: 'Streetwear', keywords: ['streetwear', 'supreme', 'bape', 'hoodie'] },
      { slug: 'vintage', name: 'Vintage', keywords: ['vintage', 'retro', 'thrift'] },
      { slug: 'designer', name: 'Designer', keywords: ['designer', 'luxury', 'gucci', 'louis vuitton', 'prada'] },
    ],
  },
  {
    slug: 'home-garden',
    name: 'Home & Garden',
    keywords: ['home', 'garden', 'house', 'decor', 'kitchen', 'outdoor'],
  },
  {
    slug: 'collectibles',
    name: 'Collectibles',
    keywords: ['collectible', 'collection', 'rare', 'antique'],
    children: [
      { slug: 'trading-cards', name: 'Trading Cards', keywords: ['card', 'pokemon', 'mtg', 'baseball card', 'sports card', 'yugioh'] },
      { slug: 'comics', name: 'Comics', keywords: ['comic', 'manga', 'graphic novel', 'marvel', 'dc'] },
    ],
  },
  {
    slug: 'jewelry-watches',
    name: 'Jewelry & Watches',
    keywords: ['jeweler', 'jewellery', 'watch store'],
    children: [
      { slug: 'luxury-watches', name: 'Luxury Watches', keywords: ['watch', 'rolex', 'omega', 'patek', 'cartier', 'breitling', 'tag heuer', 'timepiece', 'luxury watch', 'pre-owned watch'] },
      { slug: 'jewelry', name: 'Jewelry', keywords: ['jewelry', 'necklace', 'bracelet', 'ring', 'gold', 'silver', 'platinum'] },
      { slug: 'diamonds', name: 'Diamonds', keywords: ['diamond', 'engagement ring', 'diamond district', 'gemstone', 'gem'] },
    ],
  },
  {
    slug: 'services',
    name: 'Services',
    keywords: ['service', 'provider'],
    children: [
      { slug: 'childcare', name: 'Childcare', keywords: ['childcare', 'daycare', 'nanny', 'babysitter', 'babysitting', 'preschool', 'child care', 'nursery'] },
      { slug: 'pet-services', name: 'Pet Services', keywords: ['pet', 'dog walker', 'dog walking', 'pet sitter', 'pet sitting', 'groomer', 'grooming', 'kennel', 'doggy daycare'] },
      { slug: 'home-services', name: 'Home Services', keywords: ['plumber', 'electrician', 'contractor', 'handyman', 'renovation', 'hvac', 'roofing'] },
      { slug: 'tutoring', name: 'Tutoring', keywords: ['tutor', 'tutoring', 'test prep', 'sat prep', 'math tutor', 'learning center'] },
      { slug: 'auto-services', name: 'Auto Services', keywords: ['mechanic', 'auto repair', 'body shop', 'oil change', 'tire', 'auto service'] },
    ],
  },
  {
    slug: 'construction-renovation',
    name: 'Construction & Renovation',
    keywords: ['construction', 'renovation', 'building supply', 'building material', 'contractor supply', 'home improvement'],
    children: [
      { slug: 'lighting-fixtures', name: 'Lighting & Fixtures', keywords: ['lighting', 'light fixture', 'led', 'chandelier', 'lamp', 'light store'] },
      { slug: 'plumbing-supplies', name: 'Plumbing Supplies', keywords: ['plumbing', 'plumbing supply', 'pipe', 'faucet', 'bathroom fixture'] },
      { slug: 'flooring', name: 'Flooring', keywords: ['flooring', 'hardwood floor', 'tile floor', 'carpet', 'vinyl floor', 'laminate'] },
      { slug: 'tile-stone', name: 'Tile & Stone', keywords: ['tile', 'stone', 'marble', 'granite', 'ceramic tile', 'porcelain'] },
      { slug: 'kitchen-bath', name: 'Kitchen & Bath', keywords: ['kitchen cabinet', 'kitchen remodel', 'bath remodel', 'cabinet', 'countertop', 'vanity'] },
      { slug: 'paint', name: 'Paint', keywords: ['paint', 'paint store', 'benjamin moore', 'sherwin williams', 'stain', 'wallpaper'] },
      { slug: 'lumber-building', name: 'Lumber & Building Materials', keywords: ['lumber', 'lumber yard', 'building supply', 'plywood', 'drywall', 'concrete'] },
      { slug: 'electrical-supply', name: 'Electrical Supply', keywords: ['electrical supply', 'electrical store', 'wiring', 'circuit breaker', 'electrical panel'] },
      { slug: 'windows-doors', name: 'Windows & Doors', keywords: ['window', 'door', 'window store', 'door store', 'garage door', 'storm window'] },
      { slug: 'appliances', name: 'Appliances', keywords: ['appliance', 'refrigerator', 'washer', 'dryer', 'dishwasher', 'stove', 'oven'] },
      { slug: 'general-contractor', name: 'General Contractor', keywords: ['general contractor', 'GC', 'contractor', 'home improvement contractor', 'remodeling contractor'] },
      { slug: 'design-build', name: 'Design-Build Firm', keywords: ['design build', 'design-build', 'architect contractor', 'design build firm'] },
      { slug: 'electrician', name: 'Electrician', keywords: ['electrician', 'electrical contractor', 'licensed electrician', 'master electrician'] },
      { slug: 'plumber', name: 'Plumber', keywords: ['plumber', 'plumbing contractor', 'licensed plumber', 'master plumber'] },
      { slug: 'hvac', name: 'HVAC', keywords: ['hvac', 'heating', 'air conditioning', 'hvac contractor'] },
      { slug: 'roofing', name: 'Roofing', keywords: ['roofing', 'roofer', 'roofing contractor'] },
    ],
  },
  { slug: 'vehicles', name: 'Vehicles', keywords: ['car', 'truck', 'motorcycle', 'auto', 'vehicle', 'boat'] },
  { slug: 'sporting-goods', name: 'Sporting Goods', keywords: ['sport', 'fitness', 'gym', 'outdoor', 'bike', 'bicycle', 'camping'] },
  { slug: 'furniture', name: 'Furniture', keywords: ['furniture', 'couch', 'sofa', 'table', 'chair', 'desk', 'bed'] },
  { slug: 'toys-games', name: 'Toys & Games', keywords: ['toy', 'game', 'board game', 'lego', 'puzzle'] },
  { slug: 'tools', name: 'Tools', keywords: ['tool', 'power tool', 'drill', 'saw', 'hardware'] },
  { slug: 'other', name: 'Other', keywords: [] },
]

// Build flat lookup maps
const categoryBySlug = new Map<string, CategoryDef>()
const categoryByKeyword = new Map<string, string>() // keyword -> slug

for (const cat of CATEGORY_TREE) {
  categoryBySlug.set(cat.slug, cat)
  for (const kw of cat.keywords ?? []) {
    categoryByKeyword.set(kw.toLowerCase(), cat.slug)
  }
  for (const child of cat.children ?? []) {
    categoryBySlug.set(child.slug, child)
    for (const kw of child.keywords ?? []) {
      categoryByKeyword.set(kw.toLowerCase(), child.slug)
    }
  }
}

export function findCategoryBySlug(slug: string): CategoryDef | undefined {
  return categoryBySlug.get(slug)
}

export function findCategorySlugsFromKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  const matches = new Set<string>()
  for (const [keyword, slug] of categoryByKeyword) {
    if (lower.includes(keyword)) {
      matches.add(slug)
    }
  }
  return [...matches]
}

export function getParentSlug(childSlug: string): string | null {
  for (const cat of CATEGORY_TREE) {
    if (cat.children?.some(c => c.slug === childSlug)) {
      return cat.slug
    }
  }
  return null
}
