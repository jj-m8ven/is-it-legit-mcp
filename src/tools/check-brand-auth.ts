import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const checkBrandAuthSchema = z.object({
  seller_id: z.string().optional().describe('M8ven seller UUID to check authorization for'),
  slug: z.string().optional().describe('M8ven seller slug to check authorization for'),
  brand_slug: z.string().optional().describe('Optional: check authorization for a specific brand only'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug is required',
})

export type CheckBrandAuthInput = z.infer<typeof checkBrandAuthSchema>

export async function checkBrandAuth(input: CheckBrandAuthInput) {
  // Resolve seller_id from slug if needed
  let sellerId = input.seller_id
  if (!sellerId && input.slug) {
    const { data: seller } = await supabase
      .from('sellers')
      .select('id')
      .eq('slug', input.slug)
      .single()
    if (!seller) throw new Error('Seller not found')
    sellerId = seller.id
  }

  // Query all active authorizations for this seller
  let query = supabase
    .from('authorized_distributors')
    .select('distributor_id, distributor_name, authorization_tier, authorization_level, sku_scope, platforms, authorized_date, expires_at, brands!inner(name, slug, logo_url, authorization_tiers)')
    .eq('seller_id', sellerId!)
    .eq('status', 'active')

  if (input.brand_slug) {
    query = query.eq('brands.slug', input.brand_slug)
  }

  const { data: authorizations, error } = await query
  if (error) throw new Error(`Authorization check failed: ${error.message}`)

  if (!authorizations || authorizations.length === 0) {
    return {
      authorized: false,
      message: input.brand_slug
        ? `Seller is not authorized by brand "${input.brand_slug}"`
        : 'Seller has no brand authorizations',
      brand_authorizations: [],
    }
  }

  const results = authorizations.map(auth => {
    const brand = auth.brands as unknown as { name: string; slug: string; logo_url: string | null; authorization_tiers: { id: string; label: string }[] }
    const tiers = brand.authorization_tiers || []
    const tierLabel = tiers.find(t => t.id === auth.authorization_tier)?.label ?? auth.authorization_level

    return {
      brand_name: brand.name,
      brand_slug: brand.slug,
      distributor_id: auth.distributor_id,
      authorization_tier: tierLabel,
      sku_scope: auth.sku_scope ?? null,
      platforms: auth.platforms,
      authorized_date: auth.authorized_date,
      expires_at: auth.expires_at,
    }
  })

  return {
    authorized: true,
    brand_authorizations: results,
  }
}
