import { z } from 'zod'
import { supabase, APP_BASE_URL } from '../lib/supabase.js'
import { rankSeller, parseQuery, type RankedResult } from '../lib/ranking.js'
import type { SearchResult, VerificationSummary, ReviewSummary } from '../lib/types.js'

export const searchSellersSchema = z.object({
  query: z.string().optional().describe('Free text search query (e.g. "electronics sellers in Austin with fast shipping")'),
  categories: z.array(z.string()).optional().describe('Category slugs to filter by'),
  tags: z.array(z.string()).optional().describe('Tags to filter by'),
  location: z.string().optional().describe('Location filter (city, state, or "City, ST")'),
  neighborhood: z.string().optional().describe('NYC neighborhood name (e.g. "Upper East Side", "Park Slope", "Tribeca")'),
  zip_code: z.string().optional().describe('ZIP code to filter by'),
  latitude: z.number().optional().describe('Latitude for geo-radius search'),
  longitude: z.number().optional().describe('Longitude for geo-radius search'),
  radius_miles: z.number().min(0.1).max(50).optional().default(2).describe('Radius in miles for geo search (default 2)'),
  attributes: z.record(z.string()).optional().describe('Attribute key-value pairs to filter by'),
  min_trust_score: z.number().min(0).max(100).optional().describe('Minimum trust score (0-100)'),
  verified_only: z.boolean().optional().default(false).describe('Only return sellers with at least one verification'),
  age_range_min: z.number().min(0).max(18).optional().describe('Minimum age served (for childcare/activities filtering)'),
  age_range_max: z.number().min(0).max(18).optional().describe('Maximum age served (for childcare/activities filtering)'),
  has_violations: z.boolean().optional().describe('Filter by whether the provider has open violations (true = has violations, false = clean record)'),
  license_status: z.string().optional().describe('Filter by license status (e.g. "active", "expired", "suspended")'),
  negotiation_enabled: z.boolean().optional().describe('Only return providers that accept price negotiation'),
  sort_by: z.enum(['trust', 'distance', 'name', 'relevance']).optional().default('relevance').describe('Sort results by: trust score, distance (requires lat/lng), name, or relevance (default)'),
  urgency: z.enum(['today', 'this_week', 'no_rush']).optional().describe('How soon the buyer needs the item. "today" prioritizes local physical stores, "this_week" balances local and shipping, "no_rush" includes all channels'),
  priority: z.enum(['trust', 'price', 'speed', 'selection']).optional().describe('What matters most to the buyer. "trust" weights trust score higher, "price" includes resellers, "speed" prioritizes fast shipping/local pickup, "selection" weights variety'),
  channel: z.enum(['online', 'in_store', 'any']).optional().default('any').describe('Shopping channel preference'),
  limit: z.number().min(1).max(500).optional().default(10).describe('Max results to return'),
  offset: z.number().min(0).optional().default(0).describe('Offset for pagination'),
})

export type SearchSellersInput = z.infer<typeof searchSellersSchema>

// Trust tier labels (mirrors trust-score.ts getScoreStatus)
function getTrustTier(score: number): string {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Promising'
  if (score >= 50) return 'Building'
  return 'New'
}

export async function searchSellers(input: SearchSellersInput): Promise<{ results: SearchResult[]; total: number }> {
  // Parse free text query for structured signals
  const parsed = input.query ? parseQuery(input.query) : null
  const effectiveCategories = [...(input.categories ?? []), ...(parsed?.categories ?? [])]
  const effectiveAttributes = { ...(parsed?.attributes ?? {}), ...(input.attributes ?? {}) }
  const effectiveMinTrust = input.min_trust_score ?? parsed?.minTrustScore ?? null

  // Parse location from explicit param or from query
  let locationCity = parsed?.locationCity ?? null
  let locationState = parsed?.locationState ?? null
  if (input.location) {
    const parts = input.location.split(',').map(s => s.trim())
    if (parts.length === 2) {
      locationCity = parts[0]
      locationState = parts[1]
    } else {
      // Single value — check if it's a state name or abbreviation
      const { resolveLocation } = await import('../lib/ranking.js')
      const resolved = resolveLocation(parts[0])
      locationState = resolved.state
      locationCity = resolved.city
    }
  }

  // ── GEO-RADIUS SEARCH via search_sellers_nearby RPC ──
  const useGeoSearch = input.latitude != null && input.longitude != null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sellers: any[] = []
  let usedRpc = false
  // Map seller_id → distance_miles from geo results
  const distanceMap = new Map<string, number>()

  if (useGeoSearch) {
    const { data: geoSellers, error: geoError } = await supabase.rpc('search_sellers_nearby', {
      p_lat: input.latitude!,
      p_lng: input.longitude!,
      p_radius_miles: input.radius_miles ?? 2,
      p_category: effectiveCategories.length === 1 ? effectiveCategories[0] : null,
      p_neighborhood: input.neighborhood ?? null,
      p_zip_codes: input.zip_code ? [input.zip_code] : null,
      p_min_trust_score: effectiveMinTrust ?? 0,
      p_has_violations: input.has_violations ?? null,
      p_license_status: input.license_status ?? null,
      p_limit: Math.max(100, (input.limit + input.offset) * 3),
      p_offset: 0,
    })

    if (geoError) throw new Error(`Geo search failed: ${geoError.message}`)
    if (!geoSellers || geoSellers.length === 0) return { results: [], total: 0 }

    // Map RPC columns to the shape expected downstream
    sellers = geoSellers.map((s: any) => ({
      id: s.id,
      m8ven_id: s.m8ven_id,
      display_name: s.display_name,
      slug: s.slug,
      location_city: s.location_city,
      location_state: s.location_state,
      neighborhood: s.neighborhood,
      bio: s.bio,
      trust_score: s.trust_score,
      subscription_status: 'active', // RPC already filters visible sellers
      seller_source: 'open_web',
      seller_type: 'business',
      created_at: null,
      _violation_count: s.violation_count,
      _license_status: s.license_status,
    }))

    for (const s of geoSellers) {
      distanceMap.set(s.id, s.distance_miles)
    }

    usedRpc = true
  }

  // ── Standard (non-geo) search path ──
  if (!useGeoSearch) {
    // Build base query
    let query = supabase
      .from('sellers')
      .select(`
        id, m8ven_id, display_name, slug, location_city, location_state, neighborhood,
        full_address, location_zip, latitude, longitude, bio,
        trust_score, subscription_status, seller_source, seller_type,
        created_at
      `)

    // Filter: only active or open web sellers (all visible in M8ven)
    query = query.or('subscription_status.eq.active,seller_source.eq.open_web')

    // Filter: min trust score
    if (effectiveMinTrust !== null) {
      query = query.gte('trust_score', effectiveMinTrust)
    }

    // Neighborhood filter
    if (input.neighborhood) {
      query = query.ilike('neighborhood', input.neighborhood)
    }

    // ZIP code filter
    if (input.zip_code) {
      query = query.eq('location_zip', input.zip_code)
    }

    // Full-text search — skip if the query maps to a category
    // (e.g. "sneakers" → sneakers category, FTS would miss Nike, Adidas, etc.)
    const searchText = parsed?.cleanedText?.replace(/\b(seller|sellers|find|search|show|list|get|me|the|a|an|for|with)\b/gi, '').trim()
    let queryMatchesCategory = effectiveCategories.length > 0
    if (!queryMatchesCategory && searchText && searchText.length > 1) {
      const { data: catMatch } = await supabase
        .from('categories')
        .select('slug')
        .ilike('slug', `%${searchText.toLowerCase().replace(/\s+/g, '-')}%`)
        .limit(1)
      if (catMatch && catMatch.length > 0) {
        queryMatchesCategory = true
        effectiveCategories.push(catMatch[0].slug)
      }
    }

    if (searchText && searchText.length > 1 && !queryMatchesCategory) {
      query = query.textSearch('search_vector', searchText, { type: 'websearch' })
    }

    // Location filter at DB level — loose matching, OR not AND
    if (locationState && locationCity) {
      query = query.or(`location_state.ilike.${locationState},location_city.ilike.%${locationCity}%`)
    } else if (locationState) {
      query = query.or(`location_state.ilike.${locationState},location_city.ilike.%${locationState}%`)
    } else if (locationCity) {
      query = query.or(`location_city.ilike.%${locationCity}%,location_state.ilike.%${locationCity}%`)
    }

    // If category filters are active, pre-fetch matching seller IDs so the DB query
    // only returns sellers in those categories (instead of fetching random sellers
    // and filtering in-memory, which misses results when the limit is small)
    let categoryPreFiltered = false

    if (effectiveCategories.length > 0) {
      // First get category IDs from slugs
      const { data: matchedCats } = await supabase
        .from('categories')
        .select('id')
        .in('slug', effectiveCategories)

      if (!matchedCats || matchedCats.length === 0) return { results: [], total: 0 }

      const catIds = matchedCats.map(c => c.id)
      const { data: catSellers } = await supabase
        .from('seller_categories')
        .select('seller_id')
        .in('category_id', catIds)

      const sellerIds = [...new Set((catSellers ?? []).map(r => r.seller_id))]
      if (sellerIds.length === 0) return { results: [], total: 0 }

      if (sellerIds.length <= 300) {
        // Small category — use .in() pre-filter (fits in PostgREST URL)
        query = query.in('id', sellerIds)
        categoryPreFiltered = true
      } else {
        // Large category — use RPC to do the category JOIN server-side,
        // avoiding PostgREST URL length limits (~8KB)
        const fetchLimit = Math.max(300, (input.limit + input.offset) * 3)
        const rpcSearchText = (!queryMatchesCategory && searchText && searchText.length > 1) ? searchText : null
        const { data: rpcSellers, error: rpcError } = await supabase.rpc('search_sellers_by_category', {
          cat_slugs: effectiveCategories,
          search_text: rpcSearchText,
          loc_city: locationCity,
          loc_state: locationState,
          min_trust: effectiveMinTrust,
          p_neighborhood: input.neighborhood ?? null,
          p_zip_code: input.zip_code ?? null,
          fetch_limit: fetchLimit,
        })
        if (rpcError) throw new Error(`Category search failed: ${rpcError.message}`)
        if (!rpcSellers || rpcSellers.length === 0) return { results: [], total: 0 }
        sellers = rpcSellers
        categoryPreFiltered = true
        usedRpc = true
      }
    }

    if (!usedRpc) {
      // Fetch enough for post-ranking but don't over-fetch
      const fetchLimit = Math.min(200, (input.limit + input.offset) * 3)
      query = query.limit(fetchLimit)

      const { data, error } = await query
      if (error) throw new Error(`Search failed: ${error.message}`)
      if (!data || data.length === 0) return { results: [], total: 0 }
      sellers = data
    }
  }

  // Apply neighborhood filter post-RPC (RPC doesn't support neighborhood)
  if (input.neighborhood && usedRpc && !useGeoSearch) {
    sellers = sellers.filter((s: any) =>
      s.neighborhood && s.neighborhood.toLowerCase() === input.neighborhood!.toLowerCase()
    )
    if (sellers.length === 0) return { results: [], total: 0 }
  }

  // Single-RPC enrichment — replaces 5 separate .in() calls with one database roundtrip
  const sellerIds = sellers.map(s => s.id)

  const { data: enrichData, error: enrichError } = await supabase.rpc('enrich_sellers', {
    p_seller_ids: sellerIds,
  })
  if (enrichError) throw new Error(`Enrichment failed: ${enrichError.message}`)

  const enrichment = enrichData as {
    categories: { seller_id: string; slug: string }[]
    tags: { seller_id: string; tag: string }[]
    attributes: { seller_id: string; attribute_key: string; attribute_value: string }[]
    verifications: { seller_id: string; type: string }[]
    reviews: { seller_id: string; rating: number; created_at: string }[]
    violations: { seller_id: string; record_type: string }[]
    google_ratings: { seller_id: string; source: string; rating_value: string; numeric_score: number; metadata: Record<string, unknown> }[]
    profiles: { seller_id: string; profile_type: string; data: Record<string, unknown> }[]
  }

  // Index related data by seller_id
  const categoriesBySeller = new Map<string, string[]>()
  for (const row of enrichment.categories ?? []) {
    const cats = categoriesBySeller.get(row.seller_id) ?? []
    cats.push(row.slug)
    categoriesBySeller.set(row.seller_id, cats)
  }

  const tagsBySeller = new Map<string, string[]>()
  for (const row of enrichment.tags ?? []) {
    const tags = tagsBySeller.get(row.seller_id) ?? []
    tags.push(row.tag)
    tagsBySeller.set(row.seller_id, tags)
  }

  const attrsBySeller = new Map<string, Record<string, string>>()
  for (const row of enrichment.attributes ?? []) {
    const attrs = attrsBySeller.get(row.seller_id) ?? {}
    attrs[row.attribute_key] = row.attribute_value
    attrsBySeller.set(row.seller_id, attrs)
  }

  const verifsBySeller = new Map<string, Set<string>>()
  for (const row of enrichment.verifications ?? []) {
    const types = verifsBySeller.get(row.seller_id) ?? new Set()
    types.add(row.type)
    verifsBySeller.set(row.seller_id, types)
  }

  const reviewsBySeller = new Map<string, { rating: number; created_at: string }[]>()
  for (const row of enrichment.reviews ?? []) {
    const reviews = reviewsBySeller.get(row.seller_id) ?? []
    reviews.push({ rating: row.rating, created_at: row.created_at })
    reviewsBySeller.set(row.seller_id, reviews)
  }

  // Filter by verified_only
  let filteredSellers = sellers
  if (input.verified_only) {
    filteredSellers = sellers.filter(s => {
      const verifs = verifsBySeller.get(s.id)
      return verifs && verifs.size > 0
    })
  }

  // Filter by categories (if requested and not already done by geo search)
  if (effectiveCategories.length > 0 && !useGeoSearch) {
    filteredSellers = filteredSellers.filter(s => {
      const sellerCats = categoriesBySeller.get(s.id) ?? []
      return effectiveCategories.some(c => sellerCats.includes(c))
    })
  }

  // Multi-category filter for geo search (RPC only supports single category)
  if (effectiveCategories.length > 1 && useGeoSearch) {
    filteredSellers = filteredSellers.filter(s => {
      const sellerCats = categoriesBySeller.get(s.id) ?? []
      return effectiveCategories.some(c => sellerCats.includes(c))
    })
  }

  // Filter by tags
  if (input.tags && input.tags.length > 0) {
    filteredSellers = filteredSellers.filter(s => {
      const sellerTags = tagsBySeller.get(s.id) ?? []
      return input.tags!.some(t => sellerTags.includes(t))
    })
  }

  // Channel filtering
  if (input.channel === 'in_store') {
    filteredSellers = filteredSellers.filter(s => {
      const attrs = attrsBySeller.get(s.id) ?? {}
      return attrs['has_physical_store'] === 'yes'
    })
  } else if (input.channel === 'online') {
    filteredSellers = filteredSellers.filter(s => {
      const attrs = attrsBySeller.get(s.id) ?? {}
      return attrs['has_website'] === 'yes'
    })
  }

  // Batch fetch offer + violation data for filtered sellers
  const filteredSellerIds = filteredSellers.map(s => s.id)
  const offersBySeller = new Map<string, { count: number; has_negotiation: boolean }>()
  const violationsBySeller = new Map<string, number>()

  if (filteredSellerIds.length > 0) {
    const [{ data: offerData }, { data: complianceData }] = await Promise.all([
      supabase
        .from('seller_offers')
        .select('seller_id, negotiation_enabled')
        .in('seller_id', filteredSellerIds)
        .eq('is_active', true),
      supabase
        .from('compliance_records')
        .select('seller_id')
        .in('seller_id', filteredSellerIds),
    ])

    if (offerData) {
      for (const o of offerData) {
        const existing = offersBySeller.get(o.seller_id) ?? { count: 0, has_negotiation: false }
        existing.count++
        if (o.negotiation_enabled) existing.has_negotiation = true
        offersBySeller.set(o.seller_id, existing)
      }
    }

    if (complianceData) {
      for (const c of complianceData) {
        violationsBySeller.set(c.seller_id, (violationsBySeller.get(c.seller_id) ?? 0) + 1)
      }
    }
  }

  // Filter by has_violations
  if (input.has_violations !== undefined) {
    filteredSellers = filteredSellers.filter(s => {
      const count = violationsBySeller.get(s.id) ?? 0
      return input.has_violations ? count > 0 : count === 0
    })
  }

  // Filter by negotiation_enabled
  if (input.negotiation_enabled) {
    filteredSellers = filteredSellers.filter(s => {
      const offers = offersBySeller.get(s.id)
      return offers?.has_negotiation === true
    })
  }

  // Rank all results
  const now = Date.now()
  const ranked: Array<{ seller: typeof sellers[0]; rank: RankedResult }> = filteredSellers.map(s => {
    const reviews = reviewsBySeller.get(s.id) ?? []
    const reviewCount = reviews.length
    const avgRating = reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : null
    const hasRecent = reviews.some(r => (now - new Date(r.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000)
    const hasRecentish = reviews.some(r => (now - new Date(r.created_at).getTime()) < 90 * 24 * 60 * 60 * 1000)

    const rank = rankSeller(
      {
        trust_score: s.trust_score,
        seller_source: s.seller_source,
        seller_type: s.seller_type,
        category_slugs: categoriesBySeller.get(s.id) ?? [],
        tags: tagsBySeller.get(s.id) ?? [],
        attribute_map: attrsBySeller.get(s.id) ?? {},
        location_city: s.location_city,
        location_state: s.location_state,
        review_count: reviewCount,
        average_rating: avgRating,
        has_recent_review: hasRecent,
        has_recentish_review: hasRecentish,
      },
      {
        text_categories: parsed?.categories ?? [],
        requested_categories: input.categories ?? [],
        requested_tags: input.tags ?? [],
        requested_attributes: effectiveAttributes,
        location_city: locationCity,
        location_state: locationState,
        min_trust_score: effectiveMinTrust,
        text_match_score: parsed?.cleanedText ? 0.5 : 0,
        urgency: input.urgency,
        priority: input.priority,
        channel: input.channel,
      },
    )

    return { seller: s, rank }
  })

  // Sort based on sort_by parameter
  if (input.sort_by === 'distance' && useGeoSearch) {
    ranked.sort((a, b) => (distanceMap.get(a.seller.id) ?? 999) - (distanceMap.get(b.seller.id) ?? 999))
  } else if (input.sort_by === 'trust') {
    ranked.sort((a, b) => (b.seller.trust_score ?? 0) - (a.seller.trust_score ?? 0))
  } else if (input.sort_by === 'name') {
    ranked.sort((a, b) => a.seller.display_name.localeCompare(b.seller.display_name))
  } else {
    // Default: relevance score descending
    ranked.sort((a, b) => b.rank.relevance_score - a.rank.relevance_score)
  }

  // Apply pagination
  const total = ranked.length
  const paged = ranked.slice(input.offset, input.offset + input.limit)

  // Build results
  const results: SearchResult[] = paged.map(({ seller, rank }) => {
    const verifs = verifsBySeller.get(seller.id) ?? new Set()
    const reviews = reviewsBySeller.get(seller.id) ?? []
    const reviewCount = reviews.length
    const avgRating = reviewCount > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
      : null
    const recentCount = reviews.filter(r => (now - new Date(r.created_at).getTime()) < 90 * 24 * 60 * 60 * 1000).length

    const verificationSummary: VerificationSummary = {
      email: verifs.has('email'),
      phone: verifs.has('phone'),
      id_document: verifs.has('id_document'),
      business_license: verifs.has('business_license'),
      social_linkedin: verifs.has('social_linkedin'),
      social_instagram: verifs.has('social_instagram'),
      social_tiktok: verifs.has('social_tiktok'),
      marketplace_reputation: verifs.has('marketplace_reputation'),
    }

    const reviewSummary: ReviewSummary = {
      count: reviewCount,
      average_rating: avgRating,
      recent_count: recentCount,
    }

    const location = seller.location_city && seller.location_state
      ? `${seller.location_city}, ${seller.location_state}`
      : seller.location_city || seller.location_state || null

    const offerInfo = offersBySeller.get(seller.id)

    return {
      m8ven_id: seller.m8ven_id,
      display_name: seller.display_name,
      slug: seller.slug,
      passport_url: `${APP_BASE_URL}/seller/${seller.slug}`,
      trust_score: seller.trust_score,
      trust_tier: getTrustTier(seller.trust_score),
      seller_type: seller.seller_type as 'individual' | 'business' | 'brand_authorized',
      location,
      full_address: seller.full_address ?? null,
      location_zip: seller.location_zip ?? null,
      latitude: seller.latitude ?? null,
      longitude: seller.longitude ?? null,
      neighborhood: seller.neighborhood ?? null,
      distance_miles: distanceMap.get(seller.id) != null
        ? Math.round(distanceMap.get(seller.id)! * 100) / 100
        : null,
      categories: categoriesBySeller.get(seller.id) ?? [],
      tags: tagsBySeller.get(seller.id) ?? [],
      verification_summary: verificationSummary,
      review_summary: reviewSummary,
      violation_count: seller._violation_count ?? violationsBySeller.get(seller.id) ?? 0,
      license_status: seller._license_status ?? undefined,
      relevance_score: rank.relevance_score,
      match_reasons: rank.match_reasons,
      has_active_offers: (offerInfo?.count ?? 0) > 0,
    }
  })

  return { results, total }
}
