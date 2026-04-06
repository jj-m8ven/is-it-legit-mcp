// Shared types for the MCP server

export interface SellerRow {
  id: string
  m8ven_id: string
  user_id: string | null
  display_name: string
  slug: string
  email: string | null
  location_city: string | null
  location_state: string | null
  bio: string | null
  avatar_url: string | null
  trust_score: number
  subscription_status: string
  subscription_tier: string | null
  seller_source: 'registered' | 'open_web'  // internal only, never exposed in MCP responses
  seller_type: 'individual' | 'business' | 'brand_authorized'
  claimed_at: string | null
  source_url: string | null
  source_platform: string | null
  passport_theme: string | null
  created_at: string
  updated_at: string
  search_vector?: string
}

export interface VerificationRow {
  id: string
  seller_id: string
  type: string
  status: string
  reputation_tier: string | null
  verified_at: string | null
}

export interface ReviewRow {
  id: string
  seller_id: string
  reviewer_name: string
  rating: number
  title: string | null
  body: string | null
  platform: string | null
  created_at: string
}

export interface CategoryRow {
  id: string
  slug: string
  name: string
  parent_id: string | null
}

export interface SellerCategoryRow {
  id: string
  seller_id: string
  category_id: string
  source: string
  confidence: number
  categories?: CategoryRow
}

export interface SellerTagRow {
  seller_id: string
  tag: string
  source: string
  confidence: number
}

export interface SellerAttributeRow {
  seller_id: string
  attribute_key: string
  attribute_value: string
  source: string
  confidence: number
}

export interface McpApiKeyRow {
  id: string
  key_hash: string
  key_prefix: string
  name: string
  owner_email: string
  permissions: string[]
  rate_limit_per_minute: number
  is_active: boolean
  last_used_at: string | null
  allowed_categories: string[]
}

export interface SellerOfferRow {
  id: string
  seller_id: string
  offer_type: 'discount_rule' | 'promotional' | 'bundle_pricing' | 'response_template'
  title: string
  description: string | null
  conditions: Record<string, any>
  negotiation_enabled: boolean
  min_discount_percent: number
  max_discount_percent: number
  auto_accept_threshold: number
  starts_at: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface NegotiationLogRow {
  id: string
  seller_id: string
  offer_id: string | null
  api_key_id: string | null
  proposed_discount_percent: number
  proposed_price_usd: number
  original_price_usd: number
  outcome: 'accepted' | 'countered' | 'rejected'
  counter_discount_percent: number | null
  counter_price_usd: number | null
  context: Record<string, any>
  created_at: string
}

// MCP tool response types

export interface SearchResult {
  m8ven_id: string
  display_name: string
  slug: string
  passport_url: string
  trust_score: number
  trust_tier: string
  seller_type: 'individual' | 'business' | 'brand_authorized'
  location: string | null
  full_address?: string | null
  location_zip?: string | null
  latitude?: number | null
  longitude?: number | null
  neighborhood?: string | null
  distance_miles?: number | null
  categories: string[]
  tags: string[]
  verification_summary: VerificationSummary
  review_summary: ReviewSummary
  violation_count?: number
  license_status?: string | null
  relevance_score: number
  match_reasons: string[]
  has_active_offers?: boolean
}

export interface VerificationSummary {
  email: boolean
  phone: boolean
  id_document: boolean
  business_license: boolean
  social_linkedin: boolean
  social_instagram: boolean
  social_tiktok: boolean
  marketplace_reputation: boolean
}

export interface ReviewSummary {
  count: number
  average_rating: number | null
  recent_count: number
}

export interface TrustReport {
  seller: {
    m8ven_id: string
    display_name: string
    slug: string
    passport_url: string
    seller_type: 'individual' | 'business' | 'brand_authorized'
    location: string | null
    account_age_days: number
    member_since: string
  }
  trust: {
    score: number
    tier: string
    decision: 'approve' | 'conditional' | 'deny'
    reason: string
  }
  verifications: VerificationSummary
  reviews: ReviewSummary & {
    recent_reviews: Array<{
      rating: number
      title: string | null
      platform: string | null
      date: string
    }>
  }
  badges: Array<{
    id: string
    label: string
    description: string
  }>
  categories: string[]
  tags: string[]
  attributes: Record<string, string>
  licenses?: Array<{
    license_type: string
    license_number: string
    issuing_authority: string
    industry: string
    status: string
    capacity: number | null
    expires_at: string | null
    last_inspection_at: string | null
    violations: Array<{
      severity: string
      title: string
      status: string
      date: string
    }>
  }>
  context_assessment?: {
    risk_level: 'low' | 'medium' | 'high'
    recommendation: string
    factors: string[]
  }
}
