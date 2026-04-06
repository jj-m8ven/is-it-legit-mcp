import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import type { SellerOfferRow } from '../lib/types.js'

export const negotiatePriceSchema = z.object({
  seller_id: z.string().uuid().describe('Seller UUID'),
  offer_id: z.string().uuid().optional().describe('Specific offer to negotiate on (optional)'),
  original_price_usd: z.number().positive().describe('Original price in USD'),
  proposed_price_usd: z.number().positive().describe('Proposed (discounted) price in USD'),
  context: z.record(z.string()).optional().describe('Optional context (e.g., item description, quantity)'),
})

export async function negotiatePrice(
  input: z.infer<typeof negotiatePriceSchema>,
  apiKeyId?: string,
) {
  const { seller_id, offer_id, original_price_usd, proposed_price_usd, context } = input

  if (proposed_price_usd >= original_price_usd) {
    return { error: 'Proposed price must be less than original price' }
  }

  // Rate limit: 5 negotiations per seller per API key per hour
  if (apiKeyId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('negotiation_log')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', seller_id)
      .eq('api_key_id', apiKeyId)
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= 5) {
      return {
        outcome: 'rate_limited',
        message: 'Maximum 5 negotiations per seller per hour. Please try again later.',
      }
    }
  }

  // Find the relevant offer with negotiation enabled
  let offer: SellerOfferRow | null = null

  if (offer_id) {
    const { data } = await supabase
      .from('seller_offers')
      .select('*')
      .eq('id', offer_id)
      .eq('seller_id', seller_id)
      .eq('is_active', true)
      .single()
    offer = data as SellerOfferRow | null
  } else {
    // Find any negotiation-enabled offer for this seller
    const { data } = await supabase
      .from('seller_offers')
      .select('*')
      .eq('seller_id', seller_id)
      .eq('is_active', true)
      .eq('negotiation_enabled', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(1)
      .single()
    offer = data as SellerOfferRow | null
  }

  if (!offer) {
    return {
      outcome: 'rejected',
      message: 'This seller does not have negotiation enabled for any active offers.',
    }
  }

  if (!offer.negotiation_enabled) {
    return {
      outcome: 'rejected',
      message: 'Negotiation is not enabled for this offer.',
    }
  }

  // Calculate proposed discount percentage
  const proposedDiscount = ((original_price_usd - proposed_price_usd) / original_price_usd) * 100
  const autoAccept = Number(offer.auto_accept_threshold)
  const maxDiscount = Number(offer.max_discount_percent)

  let outcome: 'accepted' | 'countered' | 'rejected'
  let counterDiscount: number | null = null
  let counterPrice: number | null = null
  let message: string

  if (proposedDiscount <= autoAccept) {
    // Auto-accept: proposed discount is within seller's auto-accept range
    outcome = 'accepted'
    message = `Offer accepted! ${proposedDiscount.toFixed(1)}% discount approved.`
  } else if (proposedDiscount <= maxDiscount) {
    // Counter: proposed is more than auto-accept but within max range
    // Counter at midpoint between auto-accept threshold and proposed discount
    counterDiscount = Math.round(((autoAccept + proposedDiscount) / 2) * 100) / 100
    counterPrice = Math.round(original_price_usd * (1 - counterDiscount / 100) * 100) / 100
    outcome = 'countered'
    message = `Counter offer: ${counterDiscount.toFixed(1)}% discount ($${counterPrice.toFixed(2)}).`
  } else {
    // Reject: proposed discount exceeds maximum
    outcome = 'rejected'
    message = 'This discount is beyond what the seller can offer. Try a smaller discount.'
  }

  // Log the negotiation
  await supabase.from('negotiation_log').insert({
    seller_id,
    offer_id: offer.id,
    api_key_id: apiKeyId || null,
    proposed_discount_percent: proposedDiscount,
    proposed_price_usd,
    original_price_usd,
    outcome,
    counter_discount_percent: counterDiscount,
    counter_price_usd: counterPrice,
    context: context || {},
  })

  const result: Record<string, any> = {
    outcome,
    message,
    offer_title: offer.title,
    proposed_discount_percent: Math.round(proposedDiscount * 100) / 100,
  }

  if (outcome === 'accepted') {
    result.final_price_usd = proposed_price_usd
    result.discount_percent = Math.round(proposedDiscount * 100) / 100
  } else if (outcome === 'countered') {
    result.counter_price_usd = counterPrice
    result.counter_discount_percent = counterDiscount
  }

  return result
}
