import { z } from 'zod'
import { supabase, APP_BASE_URL } from '../lib/supabase.js'
import type { TrustReport, VerificationSummary } from '../lib/types.js'

export const getTrustReportSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug'),
  transaction_context: z.object({
    item_value_usd: z.number().optional().describe('Value of the item in USD'),
    category: z.string().optional().describe('Category of the item'),
    is_local_pickup: z.boolean().optional().describe('Whether this is a local pickup transaction'),
  }).optional().describe('Optional context about the transaction for risk-adjusted assessment'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export type GetTrustReportInput = z.infer<typeof getTrustReportSchema>

// Mirrors trust-score.ts
function getTrustDecision(score: number): { decision: 'approve' | 'conditional' | 'deny'; reason: string } {
  if (score >= 70) return { decision: 'approve', reason: 'Trust score meets approval threshold' }
  if (score >= 50) return { decision: 'conditional', reason: 'Trust score is moderate — additional verification recommended' }
  return { decision: 'deny', reason: 'Trust score is below acceptable threshold' }
}

function getTrustTier(score: number): string {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Promising'
  if (score >= 50) return 'Building'
  return 'New'
}

export async function getTrustReport(input: GetTrustReportInput): Promise<TrustReport> {
  // Fetch seller
  let query = supabase
    .from('sellers')
    .select(`
      id, m8ven_id, display_name, slug, location_city, location_state,
      bio, trust_score, subscription_status, subscription_tier,
      seller_source, seller_type, brand_group_id,
      created_at
    `)

  if (input.seller_id) {
    query = query.eq('id', input.seller_id)
  } else {
    query = query.eq('slug', input.slug!)
  }

  const { data: seller, error } = await query.single()
  if (error || !seller) throw new Error('Seller not found')

  if (seller.subscription_status !== 'active' && seller.seller_source !== 'open_web') {
    throw new Error('Seller not found')
  }

  // Parallel fetch
  const [
    { data: verifications },
    { data: reviews },
    { data: categories },
    { data: tags },
    { data: attributes },
    { data: licenseRecords },
    { data: licenseViolations },
  ] = await Promise.all([
    supabase
      .from('verifications')
      .select('type, status, verified_at')
      .eq('seller_id', seller.id)
      .eq('status', 'verified'),
    supabase
      .from('reviews')
      .select('rating, title, platform, created_at, reviewer_name')
      .eq('seller_id', seller.id)
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('seller_categories')
      .select('categories!inner(slug, name)')
      .eq('seller_id', seller.id),
    supabase
      .from('seller_tags')
      .select('tag')
      .eq('seller_id', seller.id),
    supabase
      .from('seller_attributes')
      .select('attribute_key, attribute_value')
      .eq('seller_id', seller.id),
    supabase
      .from('license_records')
      .select('id, license_type, license_number, issuing_authority, industry, status, capacity, expires_at, last_inspection_at')
      .eq('seller_id', seller.id),
    supabase
      .from('license_violations')
      .select('license_id, severity, title, status, violation_date')
      .eq('seller_id', seller.id)
      .order('violation_date', { ascending: false }),
  ])

  const verifiedTypes = new Set((verifications ?? []).map(v => v.type))
  const verificationSummary: VerificationSummary = {
    email: verifiedTypes.has('email'),
    phone: verifiedTypes.has('phone'),
    id_document: verifiedTypes.has('id_document'),
    business_license: verifiedTypes.has('business_license'),
    social_linkedin: verifiedTypes.has('social_linkedin'),
    social_instagram: verifiedTypes.has('social_instagram'),
    social_tiktok: verifiedTypes.has('social_tiktok'),
    marketplace_reputation: verifiedTypes.has('marketplace_reputation'),
  }

  const reviewList = reviews ?? []
  const reviewCount = reviewList.length
  const avgRating = reviewCount > 0
    ? Math.round((reviewList.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
    : null
  const now = Date.now()
  const recentCount = reviewList.filter(
    r => (now - new Date(r.created_at).getTime()) < 90 * 24 * 60 * 60 * 1000,
  ).length

  const accountAgeDays = Math.floor((now - new Date(seller.created_at).getTime()) / (1000 * 60 * 60 * 24))
  const isPro = seller.subscription_tier === 'pro'
  const hasRecentReview = reviewList.some(r => (now - new Date(r.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000)

  // Badges
  const badges: Array<{ id: string; label: string; description: string }> = []
  // Brand Authorized badge — first, so it's the most prominent
  if (seller.seller_type === 'brand_authorized') {
    badges.push({ id: 'brand_authorized', label: 'Brand Authorized', description: 'Official brand-authorized retailer or flagship location' })
  }
  if (verifiedTypes.has('email') && verifiedTypes.has('phone') && verifiedTypes.has('id_document')) {
    badges.push({ id: 'fully_verified', label: 'Fully Verified', description: 'Email, phone, and ID all verified' })
  }
  if (avgRating !== null && avgRating >= 4.5 && reviewCount >= 5) {
    badges.push({ id: 'top_rated', label: 'Top Rated', description: 'Average rating of 4.5+ with 5 or more reviews' })
  }
  if (accountAgeDays >= 180) {
    badges.push({ id: 'seasoned_seller', label: 'Seasoned Seller', description: 'Account active for 180+ days' })
  }
  if (new Date(seller.created_at) < new Date('2026-06-01')) {
    badges.push({ id: 'founding_member', label: 'Founding Member', description: 'Joined before June 2026' })
  }
  if (hasRecentReview) {
    badges.push({ id: 'active_seller', label: 'Active Seller', description: 'Received a review within the last 30 days' })
  }
  if (seller.trust_score >= 55) {
    badges.push({ id: 'trusted_seller', label: 'Trusted Seller', description: 'Trust score of 55 or higher' })
  }
  if (isPro && seller.trust_score >= 80) {
    badges.push({ id: 'elite_seller', label: 'Elite Seller', description: 'Pro member with trust score of 80 or higher' })
  }

  // Categories, tags, attributes
  const categoryList = (categories ?? []).map(c => {
    const catData = c.categories as unknown as { slug: string; name: string }
    return catData.name
  })
  const tagList = (tags ?? []).map(t => t.tag)
  const attributeMap: Record<string, string> = {}
  for (const attr of attributes ?? []) {
    attributeMap[attr.attribute_key] = attr.attribute_value
  }

  const location = seller.location_city && seller.location_state
    ? `${seller.location_city}, ${seller.location_state}`
    : seller.location_city || seller.location_state || null

  const { decision, reason } = getTrustDecision(seller.trust_score)

  // Context-aware risk assessment
  let contextAssessment: TrustReport['context_assessment']
  if (input.transaction_context) {
    const ctx = input.transaction_context
    const factors: string[] = []
    let riskLevel: 'low' | 'medium' | 'high' = 'low'

    // Value-based risk
    if (ctx.item_value_usd) {
      if (ctx.item_value_usd > 500) {
        factors.push(`High-value item ($${ctx.item_value_usd}) — higher trust threshold recommended`)
        if (seller.trust_score < 70) riskLevel = 'high'
        else if (seller.trust_score < 80) riskLevel = 'medium'
      } else if (ctx.item_value_usd > 100) {
        factors.push(`Moderate-value item ($${ctx.item_value_usd})`)
        if (seller.trust_score < 50) riskLevel = 'high'
        else if (seller.trust_score < 60) riskLevel = 'medium'
      }
    }

    // Profile completeness risk
    if (seller.seller_source === 'open_web') {
      factors.push('Profile has not been claimed by the seller — some data may be unverified')
      riskLevel = riskLevel === 'low' ? 'medium' : 'high'
    }

    // Verification depth
    const verCount = verifiedTypes.size
    if (verCount === 0) {
      factors.push('No verifications on file')
      riskLevel = riskLevel === 'low' ? 'medium' : 'high'
    } else if (verCount < 3) {
      factors.push(`Limited verifications (${verCount} of 7 possible)`)
    } else {
      factors.push(`${verCount} verifications completed`)
    }

    // Review history
    if (reviewCount === 0) {
      factors.push('No review history')
    } else if (avgRating !== null && avgRating < 3.5) {
      factors.push(`Below-average ratings (${avgRating})`)
      riskLevel = riskLevel === 'low' ? 'medium' : riskLevel
    } else if (reviewCount >= 5 && avgRating !== null && avgRating >= 4.5) {
      factors.push(`Strong review history (${avgRating} avg across ${reviewCount} reviews)`)
    }

    // Local pickup benefit
    if (ctx.is_local_pickup) {
      factors.push('Local pickup reduces shipping/delivery risk')
      if (riskLevel === 'medium') riskLevel = 'low'
    }

    // Account age
    if (accountAgeDays < 30) {
      factors.push('New account (less than 30 days)')
      riskLevel = riskLevel === 'low' ? 'medium' : riskLevel
    }

    let recommendation: string
    if (riskLevel === 'low') {
      recommendation = 'Transaction appears low-risk based on seller profile and context.'
    } else if (riskLevel === 'medium') {
      recommendation = 'Moderate risk — consider requesting additional verification or using a secure payment method.'
    } else {
      recommendation = 'High risk for this transaction — recommend caution, secure payment, and additional seller verification before proceeding.'
    }

    contextAssessment = { risk_level: riskLevel, recommendation, factors }
  }

  // Fetch brand group context if applicable
  let brandContext: {
    brand_name: string
    brand_avg_trust_score: number | null
    total_locations: number
    location_vs_brand: 'above_average' | 'average' | 'below_average'
  } | undefined

  if (seller.brand_group_id) {
    const { data: brandGroup } = await supabase
      .from('brand_groups')
      .select('name, avg_trust_score, total_locations')
      .eq('id', seller.brand_group_id)
      .single()

    if (brandGroup && brandGroup.avg_trust_score) {
      const diff = seller.trust_score - brandGroup.avg_trust_score
      brandContext = {
        brand_name: brandGroup.name,
        brand_avg_trust_score: brandGroup.avg_trust_score,
        total_locations: brandGroup.total_locations,
        location_vs_brand: diff > 3 ? 'above_average' : diff < -3 ? 'below_average' : 'average',
      }
    }
  }

  // Build license data for response
  const licensesForReport = (licenseRecords ?? []).map(lr => ({
    license_type: lr.license_type,
    license_number: lr.license_number,
    issuing_authority: lr.issuing_authority,
    industry: lr.industry,
    status: lr.status,
    capacity: lr.capacity,
    expires_at: lr.expires_at,
    last_inspection_at: lr.last_inspection_at,
    violations: (licenseViolations ?? [])
      .filter(v => v.license_id === lr.id)
      .map(v => ({
        severity: v.severity,
        title: v.title,
        status: v.status,
        date: v.violation_date,
      })),
  }))

  return {
    seller: {
      m8ven_id: seller.m8ven_id,
      display_name: seller.display_name,
      slug: seller.slug,
      passport_url: `${APP_BASE_URL}/seller/${seller.slug}`,
      seller_type: seller.seller_type as 'individual' | 'business' | 'brand_authorized',
      location,
      account_age_days: accountAgeDays,
      member_since: seller.created_at,
    },
    trust: {
      score: seller.trust_score,
      tier: getTrustTier(seller.trust_score),
      decision,
      reason,
      ...(brandContext ? { brand_context: brandContext } : {}),
    },
    verifications: verificationSummary,
    reviews: {
      count: reviewCount,
      average_rating: avgRating,
      recent_count: recentCount,
      recent_reviews: reviewList.slice(0, 5).map(r => ({
        rating: r.rating,
        title: r.title,
        platform: r.platform,
        date: r.created_at,
      })),
    },
    badges,
    categories: categoryList,
    tags: tagList,
    attributes: attributeMap,
    ...(licensesForReport.length > 0 ? { licenses: licensesForReport } : {}),
    context_assessment: contextAssessment,
  }
}
