import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const getSellerPeopleSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug'),
  role: z.string().optional().describe('Filter by role (e.g. "teacher", "administrator", "head")'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export type GetSellerPeopleInput = z.infer<typeof getSellerPeopleSchema>

export async function getSellerPeople(input: GetSellerPeopleInput) {
  let sellerId = input.seller_id
  if (!sellerId && input.slug) {
    const { data } = await supabase.from('sellers').select('id').eq('slug', input.slug).single()
    if (!data) throw new Error('Seller not found')
    sellerId = data.id
  }

  // Fetch relationships (without PostgREST join — polymorphic FK not supported)
  const { data: rels, error } = await supabase
    .from('relationships')
    .select('source_id, relationship, role, department, is_current, started_at')
    .eq('target_type', 'seller')
    .eq('target_id', sellerId!)
    .eq('source_type', 'person')
    .eq('is_current', true)
    .limit(50)

  if (error) throw new Error(`Failed to fetch relationships: ${error.message}`)
  if (!rels || rels.length === 0) return { people: [], total: 0 }

  // Fetch people by IDs
  const personIds = rels.map(r => r.source_id)
  const { data: people, error: pError } = await supabase
    .from('people')
    .select('id, full_name, slug, title, credentials')
    .in('id', personIds)

  if (pError) throw new Error(`Failed to fetch people: ${pError.message}`)

  const peopleMap = new Map((people ?? []).map(p => [p.id, p]))

  let results = rels.map(r => {
    const person = peopleMap.get(r.source_id)
    if (!person) return null
    return {
      id: person.id,
      full_name: person.full_name,
      slug: person.slug,
      title: person.title,
      credentials: person.credentials,
      relationship: r.relationship,
      role: r.role,
      department: r.department,
    }
  }).filter(Boolean) as Array<{
    id: string; full_name: string; slug: string; title: string | null;
    credentials: string[] | null; relationship: string; role: string | null; department: string | null
  }>

  if (input.role) {
    const roleLower = input.role.toLowerCase()
    results = results.filter(r =>
      r.relationship?.toLowerCase().includes(roleLower) ||
      r.role?.toLowerCase().includes(roleLower)
    )
  }

  return { people: results, total: results.length }
}
