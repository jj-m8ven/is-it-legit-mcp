import { z } from 'zod'
import { supabase, APP_BASE_URL } from '../lib/supabase.js'
import type { VerificationSummary, ReviewSummary } from '../lib/types.js'

export const getSellerSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug (URL-friendly name)'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export type GetSellerInput = z.infer<typeof getSellerSchema>

function getTrustTier(score: number): string {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Promising'
  if (score >= 50) return 'Building'
  return 'New'
}

export async function getSeller(input: GetSellerInput) {
  // Fetch seller
  let query = supabase
    .from('sellers')
    .select(`
      id, m8ven_id, display_name, slug, location_city, location_state,
      neighborhood, full_address, location_zip, latitude, longitude, phone,
      bio, avatar_url, trust_score, subscription_status, subscription_tier,
      seller_source, seller_type, brand_group_id,
      social_linkedin, social_instagram, social_tiktok,
      created_at
    `)

  if (input.seller_id) {
    query = query.eq('id', input.seller_id)
  } else {
    query = query.eq('slug', input.slug!)
  }

  const { data: seller, error } = await query.single()
  if (error || !seller) {
    throw new Error('Seller not found')
  }

  // Only return active registered sellers or open web sellers
  if (seller.subscription_status !== 'active' && seller.seller_source !== 'open_web') {
    throw new Error('Seller not found')
  }

  // Parallel fetch related data (core + enriched)
  const [
    { data: verifications },
    { data: reviews },
    { data: categories },
    { data: tags },
    { data: attributes },
    { count: viewCount },
    { data: sellerProfile },
    { data: complianceRecords },
    { data: newsMentions },
    { data: relationships },
  ] = await Promise.all([
    supabase
      .from('verifications')
      .select('type, status, verified_at')
      .eq('seller_id', seller.id)
      .eq('status', 'verified'),
    supabase
      .from('reviews')
      .select('id, reviewer_name, rating, title, body, platform, created_at')
      .eq('seller_id', seller.id)
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(10),
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
      .from('passport_views')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', seller.id),
    // Seller profile (school, tutor, nanny_agency structured data)
    supabase
      .from('seller_profiles')
      .select('profile_type, data, source, updated_at')
      .eq('seller_id', seller.id)
      .limit(5),
    // Compliance records (violations, lawsuits, complaints)
    supabase
      .from('compliance_records')
      .select('record_type, title, severity, status, occurred_at, resolved_at, financial_amount, source')
      .eq('seller_id', seller.id)
      .order('occurred_at', { ascending: false })
      .limit(20),
    // News mentions
    supabase
      .from('news_mentions')
      .select('headline, summary, article_url, source_name, published_at, sentiment, category')
      .eq('seller_id', seller.id)
      .order('published_at', { ascending: false })
      .limit(10),
    // People/staff relationships (separate queries — polymorphic FK not supported by PostgREST)
    supabase
      .from('relationships')
      .select('source_id, relationship, role, department, is_current, started_at, ended_at')
      .eq('target_type', 'seller')
      .eq('target_id', seller.id)
      .eq('source_type', 'person')
      .eq('is_current', true)
      .limit(30),
  ])

  // Fetch people for staff relationships (separate query due to polymorphic FK)
  let staffPeopleMap = new Map<string, { full_name: string; title: string | null; credentials: string[] | null }>()
  if (relationships && relationships.length > 0) {
    const personIds = relationships.map((r: any) => r.source_id)
    const { data: staffPeople } = await supabase
      .from('people')
      .select('id, full_name, title, credentials')
      .in('id', personIds)
    if (staffPeople) {
      staffPeopleMap = new Map(staffPeople.map(p => [p.id, p]))
    }
  }

  // Build verification summary
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

  // Build review summary
  const reviewList = reviews ?? []
  const reviewCount = reviewList.length
  const avgRating = reviewCount > 0
    ? Math.round((reviewList.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
    : null
  const now = Date.now()
  const recentCount = reviewList.filter(
    r => (now - new Date(r.created_at).getTime()) < 90 * 24 * 60 * 60 * 1000,
  ).length

  const reviewSummary: ReviewSummary = {
    count: reviewCount,
    average_rating: avgRating,
    recent_count: recentCount,
  }

  // Build badges (simplified — mirrors badges.ts logic)
  const accountAgeDays = Math.floor((now - new Date(seller.created_at).getTime()) / (1000 * 60 * 60 * 24))
  const isPro = seller.subscription_tier === 'pro'
  const hasRecentReview = reviewList.some(r => (now - new Date(r.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000)

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

  // Build category list
  const categoryList = (categories ?? []).map(c => {
    const catData = c.categories as unknown as { slug: string; name: string }
    return { slug: catData.slug, name: catData.name }
  })

  // Build attribute map
  const attributeMap: Record<string, string> = {}
  for (const attr of attributes ?? []) {
    attributeMap[attr.attribute_key] = attr.attribute_value
  }

  const location = seller.location_city && seller.location_state
    ? `${seller.location_city}, ${seller.location_state}`
    : seller.location_city || seller.location_state || null

  // Fetch brand group + related stores if this seller belongs to one
  let brandInfo: {
    brand_name: string
    brand_trust_score: number | null
    total_locations: number
    related_stores: Array<{
      m8ven_id: string
      display_name: string
      slug: string
      passport_url: string
      location: string | null
      trust_score: number
    }>
  } | undefined

  if (seller.brand_group_id) {
    const [
      { data: brandGroup },
      { data: relatedSellers },
    ] = await Promise.all([
      supabase
        .from('brand_groups')
        .select('name, avg_trust_score, total_locations')
        .eq('id', seller.brand_group_id)
        .single(),
      supabase
        .from('sellers')
        .select('m8ven_id, display_name, slug, location_city, location_state, trust_score')
        .eq('brand_group_id', seller.brand_group_id)
        .neq('id', seller.id)
        .order('trust_score', { ascending: false })
        .limit(10),
    ])

    if (brandGroup) {
      brandInfo = {
        brand_name: brandGroup.name,
        brand_trust_score: brandGroup.avg_trust_score,
        total_locations: brandGroup.total_locations,
        related_stores: (relatedSellers ?? []).map(rs => ({
          m8ven_id: rs.m8ven_id,
          display_name: rs.display_name,
          slug: rs.slug,
          passport_url: `${APP_BASE_URL}/seller/${rs.slug}`,
          location: rs.location_city && rs.location_state
            ? `${rs.location_city}, ${rs.location_state}`
            : rs.location_city || rs.location_state || null,
          trust_score: rs.trust_score,
        })),
      }
    }
  }

  // School data completeness score (v3 spec: schools get completeness, not trust score)
  const isSchool = categoryList.some(c =>
    ['schools', 'private-schools', 'public-schools', 'nursery-schools', 'boarding-schools'].includes(c.slug)
  )
  let dataCompleteness: { score: number; verified_fields: string[]; missing_fields: string[] } | undefined
  if (isSchool && sellerProfile && sellerProfile.length > 0) {
    const schoolProfile = sellerProfile.find(p => p.profile_type === 'school')
    if (schoolProfile) {
      const data = schoolProfile.data as Record<string, any>
      const p0Fields = [
        'grades_served', 'tuition', 'school_type', 'requires_erb',
        'application_deadline', 'admissions_decision_date', 'school_philosophy',
      ]
      const p1Fields = [
        'enrollment_total', 'student_teacher_ratio', 'open_house_dates',
        'notable_programs', 'faculty_count', 'feeder_schools', 'financial_aid_available',
      ]
      const allFields = [...p0Fields, ...p1Fields]
      const verified: string[] = []
      const missing: string[] = []
      for (const f of allFields) {
        const val = data[f]
        if (val != null && val !== '' && !(Array.isArray(val) && val.length === 0)) {
          verified.push(f)
        } else {
          missing.push(f)
        }
      }
      // Also check base seller fields
      if (seller.bio) verified.push('bio')
      else missing.push('bio')
      if (seller.avatar_url) verified.push('avatar')
      else missing.push('avatar')

      const total = verified.length + missing.length
      dataCompleteness = {
        score: Math.round((verified.length / total) * 100),
        verified_fields: verified,
        missing_fields: missing,
      }
    }
  }

  return {
    m8ven_id: seller.m8ven_id,
    display_name: seller.display_name,
    slug: seller.slug,
    passport_url: `${APP_BASE_URL}/seller/${seller.slug}`,
    seller_type: seller.seller_type,
    bio: seller.bio,
    avatar_url: seller.avatar_url,
    location,
    full_address: seller.full_address,
    location_zip: seller.location_zip,
    latitude: seller.latitude,
    longitude: seller.longitude,
    neighborhood: seller.neighborhood,
    phone: seller.phone,
    trust_score: seller.trust_score,
    trust_tier: getTrustTier(seller.trust_score),
    ...(dataCompleteness ? { data_completeness: dataCompleteness } : {}),
    member_since: seller.created_at,
    account_age_days: accountAgeDays,
    social: {
      linkedin: seller.social_linkedin,
      instagram: seller.social_instagram,
      tiktok: seller.social_tiktok,
    },
    verifications: verificationSummary,
    reviews: {
      ...reviewSummary,
      recent_reviews: reviewList.slice(0, 5).map(r => ({
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        title: r.title,
        body: r.body,
        platform: r.platform,
        date: r.created_at,
      })),
    },
    badges,
    categories: categoryList,
    tags: (tags ?? []).map(t => t.tag),
    attributes: attributeMap,
    passport_views: viewCount ?? 0,
    ...(brandInfo ? { brand: brandInfo } : {}),
    ...(await getOffersSummary(seller.id)),
    // Enriched data — only included when available
    ...(sellerProfile && sellerProfile.length > 0 ? {
      profile: sellerProfile.map(p => ({
        type: p.profile_type,
        data: p.data,
        source: p.source,
        last_updated: p.updated_at,
      })),
    } : {}),
    ...(complianceRecords && complianceRecords.length > 0 ? {
      compliance: {
        total_records: complianceRecords.length,
        records: complianceRecords.map(r => ({
          type: r.record_type,
          title: r.title,
          severity: r.severity,
          status: r.status,
          date: r.occurred_at,
          resolved_at: r.resolved_at,
          financial_amount: r.financial_amount,
          source: r.source,
        })),
      },
    } : {}),
    ...(newsMentions && newsMentions.length > 0 ? {
      news: newsMentions.map(n => ({
        headline: n.headline,
        summary: n.summary,
        url: n.article_url,
        source: n.source_name,
        published_at: n.published_at,
        sentiment: n.sentiment,
        category: n.category,
      })),
    } : {}),
    ...(relationships && relationships.length > 0 ? {
      staff: relationships.map((r: any) => {
        const person = staffPeopleMap.get(r.source_id)
        return {
          name: person?.full_name ?? 'Unknown',
          title: person?.title ?? null,
          credentials: person?.credentials ?? null,
          role: r.role,
          relationship: r.relationship,
          department: r.department,
        }
      }).filter((s: any) => s.name !== 'Unknown'),
    } : {}),
  }
}

async function getOffersSummary(sellerId: string) {
  const { data: offers } = await supabase
    .from('seller_offers')
    .select('offer_type, negotiation_enabled')
    .eq('seller_id', sellerId)
    .eq('is_active', true)

  if (!offers || offers.length === 0) return {}

  const types = [...new Set(offers.map(o => o.offer_type))]
  const hasNegotiation = offers.some(o => o.negotiation_enabled)

  return {
    offers_summary: {
      count: offers.length,
      has_negotiation: hasNegotiation,
      types,
    },
  }
}
