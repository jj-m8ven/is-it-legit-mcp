import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const getSellerEventsSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug'),
  upcoming_only: z.boolean().optional().default(true).describe('Only return future events'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export type GetSellerEventsInput = z.infer<typeof getSellerEventsSchema>

export async function getSellerEvents(input: GetSellerEventsInput) {
  let sellerId = input.seller_id
  if (!sellerId && input.slug) {
    const { data } = await supabase.from('sellers').select('id, display_name').eq('slug', input.slug).single()
    if (!data) throw new Error('Seller not found')
    sellerId = data.id
  }

  const { data: profile } = await supabase
    .from('seller_profiles')
    .select('data, updated_at')
    .eq('seller_id', sellerId!)
    .in('profile_type', ['venue', 'restaurant'])
    .single()

  if (!profile) return { events: [], total: 0 }

  let events: Array<Record<string, unknown>> = profile.data?.events ?? []

  if (input.upcoming_only) {
    const today = new Date().toISOString().split('T')[0]
    events = events.filter((e: any) => !e.date || e.date >= today)
  }

  return {
    events,
    total: events.length,
    last_updated: profile.updated_at,
  }
}
