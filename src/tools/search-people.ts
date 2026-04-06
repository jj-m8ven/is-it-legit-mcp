import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const searchPeopleSchema = z.object({
  query: z.string().optional().describe('Search by name'),
  role: z.enum(['teacher', 'tutor', 'consultant', 'administrator']).optional().describe('Filter by professional role'),
  subjects: z.array(z.string()).optional().describe('Filter by subject specialization (e.g. ["ERB", "math"])'),
  employer_id: z.string().uuid().optional().describe('Filter by current employer (seller UUID)'),
  employer_slug: z.string().optional().describe('Filter by current employer slug'),
  location: z.string().optional().describe('Filter by location'),
  limit: z.number().min(1).max(50).optional().default(10),
  offset: z.number().min(0).optional().default(0),
})

export type SearchPeopleInput = z.infer<typeof searchPeopleSchema>

export async function searchPeople(input: SearchPeopleInput) {
  const limit = input.limit
  const offset = input.offset

  let query = supabase
    .from('people')
    .select('id, full_name, slug, title, credentials, bio, metadata, created_at')

  if (input.query) {
    query = query.ilike('full_name', `%${input.query}%`)
  }

  // Pre-filter by role in DB when possible (avoids truncation)
  if (input.role) {
    query = query.eq('metadata->>role', input.role)
  }

  query = query.order('full_name').limit(500)

  const { data: people, error } = await query
  if (error) throw new Error(`People search failed: ${error.message}`)
  if (!people || people.length === 0) return { results: [], total: 0 }

  let filtered = people

  if (input.role) {
    filtered = filtered.filter(p => {
      const meta = p.metadata as any
      // Check explicit role first
      if (meta?.role === input.role) return true
      // Infer role from title/metadata for seeded records
      const title = (p.title ?? '').toLowerCase()
      const dept = (meta?.department ?? '').toLowerCase()
      switch (input.role) {
        case 'teacher':
          return title.includes('teacher') || title.includes('department head') || dept.includes('school')
        case 'administrator':
          return title.includes('director') || title.includes('head of school') || title.includes('dean') || meta?.is_head === true
        case 'tutor':
          return meta?.role === 'tutor' || title.includes('tutor')
        case 'consultant':
          return meta?.role === 'consultant' || title.includes('consultant') || title.includes('advisor')
        default:
          return false
      }
    })
  }

  if (input.subjects && input.subjects.length > 0) {
    filtered = filtered.filter(p => {
      const subjects: string[] = (p.metadata as any)?.subjects ?? []
      return input.subjects!.some(s => subjects.some(ps => ps.toLowerCase().includes(s.toLowerCase())))
    })
  }

  // Resolve employer_slug to ID
  let employerId = input.employer_id
  if (!employerId && input.employer_slug) {
    const { data } = await supabase.from('sellers').select('id').eq('slug', input.employer_slug).single()
    if (data) employerId = data.id
  }

  if (employerId) {
    const { data: rels } = await supabase
      .from('relationships')
      .select('source_id')
      .eq('source_type', 'person')
      .eq('target_type', 'seller')
      .eq('target_id', employerId)
      .eq('is_current', true)
    const ids = new Set((rels ?? []).map(r => r.source_id))
    filtered = filtered.filter(p => ids.has(p.id))
  }

  const total = filtered.length
  const paged = filtered.slice(offset, offset + limit)

  return {
    results: paged.map(p => ({
      id: p.id,
      full_name: p.full_name,
      slug: p.slug,
      title: p.title,
      credentials: p.credentials,
      bio: p.bio,
      role: (p.metadata as any)?.role,
      subjects: (p.metadata as any)?.subjects,
    })),
    total,
  }
}
