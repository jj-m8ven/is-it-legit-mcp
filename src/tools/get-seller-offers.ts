import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import type { SellerOfferRow } from '../lib/types.js'

export const getSellerOffersSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug (e.g., m8v-abc12345)'),
  offer_type: z
    .enum(['discount_rule', 'promotional', 'bundle_pricing', 'response_template'])
    .optional()
    .describe('Filter by offer type'),
}).refine((data) => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export async function getSellerOffers(input: z.infer<typeof getSellerOffersSchema>) {
  // Resolve seller
  let sellerId = input.seller_id
  let sellerName = ''

  if (input.slug && !sellerId) {
    const { data: seller } = await supabase
      .from('sellers')
      .select('id, display_name')
      .eq('slug', input.slug)
      .single()

    if (!seller) {
      return { error: 'Seller not found' }
    }
    sellerId = seller.id
    sellerName = seller.display_name
  } else if (sellerId) {
    const { data: seller } = await supabase
      .from('sellers')
      .select('display_name')
      .eq('id', sellerId)
      .single()
    sellerName = seller?.display_name || ''
  }

  // Fetch active offers
  let query = supabase
    .from('seller_offers')
    .select('*')
    .eq('seller_id', sellerId!)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  if (input.offer_type) {
    query = query.eq('offer_type', input.offer_type)
  }

  const { data: offers } = await query.order('created_at', { ascending: false })

  if (!offers || offers.length === 0) {
    return {
      seller_name: sellerName,
      offers: [],
      message: 'This seller has no active offers at this time.',
    }
  }

  // Format offers — DO NOT expose min/max discount boundaries (seller's private info)
  const formattedOffers = (offers as SellerOfferRow[]).map((offer) => ({
    offer_id: offer.id,
    type: offer.offer_type,
    title: offer.title,
    description: offer.description,
    conditions: offer.conditions,
    negotiation_enabled: offer.negotiation_enabled,
    starts_at: offer.starts_at,
    expires_at: offer.expires_at,
  }))

  return {
    seller_name: sellerName,
    offer_count: formattedOffers.length,
    has_negotiation: formattedOffers.some((o) => o.negotiation_enabled),
    offers: formattedOffers,
  }
}
