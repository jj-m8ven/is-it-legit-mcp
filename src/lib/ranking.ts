import { findCategorySlugsFromKeywords, getParentSlug } from '../config/categories.js'
import { ATTRIBUTE_KEYWORDS } from '../config/attributes.js'

// Ranking weights
const WEIGHTS = {
  trust: 0.35,
  category: 0.25,
  attribute: 0.15,
  location: 0.10,
  review: 0.10,
  recency: 0.05,
}

const OPEN_WEB_PENALTY = 0.85
const BRAND_AUTHORIZED_BOOST = 1.10

interface RankingInput {
  trust_score: number
  seller_source: 'registered' | 'open_web'
  seller_type: 'individual' | 'business' | 'brand_authorized'
  category_slugs: string[]     // seller's categories
  tags: string[]               // seller's tags
  attribute_map: Record<string, string>  // seller's attributes
  location_city: string | null
  location_state: string | null
  review_count: number
  average_rating: number | null
  has_recent_review: boolean    // within 30 days
  has_recentish_review: boolean // within 90 days
}

interface RankingQuery {
  text_categories: string[]    // categories extracted from free text
  requested_categories: string[] // explicitly requested categories
  requested_tags: string[]
  requested_attributes: Record<string, string>
  location_city: string | null
  location_state: string | null
  min_trust_score: number | null
  text_match_score: number     // full-text search rank (0-1)
  urgency?: 'today' | 'this_week' | 'no_rush'
  priority?: 'trust' | 'price' | 'speed' | 'selection'
  channel?: 'online' | 'in_store' | 'any'
}

export interface RankedResult {
  relevance_score: number
  match_reasons: string[]
}

export function rankSeller(input: RankingInput, query: RankingQuery): RankedResult {
  const reasons: string[] = []
  const scores: Record<string, number> = {}
  const available: Record<string, boolean> = {}

  // Trust score (0-1 normalized)
  scores.trust = input.trust_score / 100
  available.trust = true

  // Category match
  const allQueryCategories = [...new Set([...query.text_categories, ...query.requested_categories])]
  if (allQueryCategories.length > 0) {
    let bestMatch = 0
    for (const qCat of allQueryCategories) {
      if (input.category_slugs.includes(qCat)) {
        bestMatch = Math.max(bestMatch, 1.0)
        reasons.push(`Matches category: ${qCat}`)
      } else {
        // Check parent match
        const parent = getParentSlug(qCat)
        if (parent && input.category_slugs.includes(parent)) {
          bestMatch = Math.max(bestMatch, 0.7)
          reasons.push(`Parent category match: ${parent}`)
        } else {
          // Check if any seller category is a child of the query category
          for (const sCat of input.category_slugs) {
            const sParent = getParentSlug(sCat)
            if (sParent === qCat) {
              bestMatch = Math.max(bestMatch, 0.7)
              reasons.push(`Subcategory match: ${sCat}`)
            }
          }
        }
      }
    }
    // Fuzzy tag-based category matching
    if (bestMatch === 0 && input.tags.length > 0) {
      const tagCategories = findCategorySlugsFromKeywords(input.tags.join(' '))
      for (const tc of tagCategories) {
        if (allQueryCategories.includes(tc)) {
          bestMatch = Math.max(bestMatch, 0.4)
          reasons.push(`Tag suggests category: ${tc}`)
        }
      }
    }
    scores.category = bestMatch
    available.category = true
  } else {
    available.category = false
  }

  // Attribute match
  const requestedAttrs = query.requested_attributes
  const attrKeys = Object.keys(requestedAttrs)
  if (attrKeys.length > 0) {
    let matched = 0
    for (const key of attrKeys) {
      if (input.attribute_map[key] === requestedAttrs[key]) {
        matched++
        reasons.push(`Matches ${key}: ${requestedAttrs[key]}`)
      }
    }
    scores.attribute = matched / attrKeys.length
    available.attribute = true
  } else {
    available.attribute = false
  }

  // Location match
  if (query.location_city || query.location_state) {
    if (query.location_city && input.location_city?.toLowerCase() === query.location_city.toLowerCase()) {
      scores.location = 1.0
      reasons.push(`Located in ${input.location_city}`)
    } else if (query.location_state && input.location_state?.toLowerCase() === query.location_state.toLowerCase()) {
      scores.location = 0.5
      reasons.push(`Located in ${input.location_state}`)
    } else {
      scores.location = 0.0
    }
    available.location = true
  } else {
    available.location = false
  }

  // Review quality
  if (input.review_count > 0 && input.average_rating !== null) {
    const ratingComponent = input.average_rating / 5.0
    const volumeComponent = Math.min(1.0, Math.log(input.review_count + 1) / Math.log(50))
    scores.review = ratingComponent * 0.7 + volumeComponent * 0.3
    available.review = true
    if (input.average_rating >= 4.5 && input.review_count >= 5) {
      reasons.push(`Top rated: ${input.average_rating.toFixed(1)} avg (${input.review_count} reviews)`)
    }
  } else {
    available.review = false
  }

  // Recency
  if (input.has_recent_review) {
    scores.recency = 1.0
    available.recency = true
  } else if (input.has_recentish_review) {
    scores.recency = 0.5
    available.recency = true
  } else {
    available.recency = false
  }

  // Compute weighted score with renormalization for missing signals
  let totalWeight = 0
  let weightedSum = 0

  for (const [component, weight] of Object.entries(WEIGHTS)) {
    if (available[component]) {
      totalWeight += weight
      weightedSum += weight * (scores[component] ?? 0)
    } else {
      // Missing = neutral contribution
      totalWeight += weight
      weightedSum += weight * 0.5
    }
  }

  let finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0

  // Add text search relevance boost
  if (query.text_match_score > 0) {
    finalScore = finalScore * 0.8 + query.text_match_score * 0.2
    reasons.push('Text search match')
  }

  // Context-aware weight adjustments
  if (query.priority === 'trust') {
    // Boost trust component by 50%
    if (available.trust) {
      finalScore += scores.trust * 0.15  // extra trust weight
    }
  }

  if (query.urgency === 'today') {
    // Strong boost for local/in-store pickup
    if (available.location && scores.location > 0) {
      finalScore += scores.location * 0.20  // significant location boost
      reasons.push('Available nearby for same-day pickup')
    }
  }

  if (query.urgency === 'this_week') {
    // Moderate boost for location
    if (available.location && scores.location > 0) {
      finalScore += scores.location * 0.10
    }
  }

  if (query.priority === 'speed') {
    // Boost sellers with fast shipping or in-store pickup
    if (available.location && scores.location > 0) {
      finalScore += scores.location * 0.15
      reasons.push('Fast fulfillment option')
    }
  }

  if (query.priority === 'selection') {
    // Boost category match importance
    if (available.category && scores.category > 0) {
      finalScore += scores.category * 0.10
    }
  }

  // Brand authorized boost — these are official brand locations
  if (input.seller_type === 'brand_authorized') {
    finalScore *= BRAND_AUTHORIZED_BOOST
    reasons.push('Brand Authorized seller')
  }

  // Unclaimed profile penalty
  if (input.seller_source === 'open_web') {
    finalScore *= OPEN_WEB_PENALTY
  }

  if (input.seller_source === 'registered') {
    reasons.push('Verified M8ven member')
  }

  return {
    relevance_score: Math.round(finalScore * 1000) / 1000,
    match_reasons: reasons,
  }
}

// Parse free text query to extract structured components
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
}

const STATE_ABBREVS = new Set(Object.values(US_STATES))

// Resolve a single location string to city/state
export function resolveLocation(value: string): { city: string | null; state: string | null } {
  const lower = value.toLowerCase().trim()
  // Check if it's a full state name (e.g. "New York", "Texas")
  if (US_STATES[lower]) {
    return { city: null, state: US_STATES[lower] }
  }
  // Check if it's a state abbreviation (e.g. "NY", "TX")
  if (STATE_ABBREVS.has(value.toUpperCase().trim())) {
    return { city: null, state: value.toUpperCase().trim() }
  }
  // Otherwise treat as city
  return { city: value.trim(), state: null }
}

export interface ParsedQuery {
  cleanedText: string
  categories: string[]
  attributes: Record<string, string>
  locationCity: string | null
  locationState: string | null
  minTrustScore: number | null
}

export function parseQuery(text: string): ParsedQuery {
  let cleaned = text
  const categories: string[] = []
  const attributes: Record<string, string> = {}
  let locationCity: string | null = null
  let locationState: string | null = null
  let minTrustScore: number | null = null

  // Extract location patterns like "in Austin" or "in New York" or "in Austin, TX"
  const locationMatch = cleaned.match(/\b(?:in|near|around|from)\s+([A-Za-z][A-Za-z\s]*)(?:\s*,\s*([A-Za-z]{2}))?\s*$/i)
  if (locationMatch) {
    const place = locationMatch[1].trim().toLowerCase()
    const stateAbbrev = locationMatch[2]?.toUpperCase()

    if (stateAbbrev && STATE_ABBREVS.has(stateAbbrev)) {
      locationState = stateAbbrev
      locationCity = locationMatch[1].trim()
    } else if (US_STATES[place]) {
      locationState = US_STATES[place]
    } else if (STATE_ABBREVS.has(place.toUpperCase())) {
      locationState = place.toUpperCase()
    } else {
      locationCity = locationMatch[1].trim()
    }
    cleaned = cleaned.replace(locationMatch[0], '').trim()
  }

  // Extract trust level keywords
  if (/\b(?:trusted|reliable|reputable|verified)\b/i.test(cleaned)) {
    minTrustScore = 60
    cleaned = cleaned.replace(/\b(?:trusted|reliable|reputable|verified)\b/gi, '').trim()
  }
  if (/\b(?:highly trusted|very trusted|excellent)\b/i.test(cleaned)) {
    minTrustScore = 80
    cleaned = cleaned.replace(/\b(?:highly trusted|very trusted|excellent)\b/gi, '').trim()
  }

  // Extract attribute keywords
  for (const [keyword, attr] of Object.entries(ATTRIBUTE_KEYWORDS)) {
    if (cleaned.toLowerCase().includes(keyword)) {
      attributes[attr.key] = attr.value
      cleaned = cleaned.replace(new RegExp(keyword, 'gi'), '').trim()
    }
  }

  // Extract category keywords
  const foundCategories = findCategorySlugsFromKeywords(cleaned)
  categories.push(...foundCategories)

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return {
    cleanedText: cleaned,
    categories,
    attributes,
    locationCity,
    locationState,
    minTrustScore,
  }
}
