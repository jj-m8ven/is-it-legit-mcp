import { z } from 'zod'
import { supabase, APP_BASE_URL } from '../lib/supabase.js'

export const getPersonSchema = z.object({
  person_id: z.string().uuid().optional().describe('Person UUID'),
  slug: z.string().optional().describe('Person slug'),
}).refine(data => data.person_id || data.slug, {
  message: 'Either person_id or slug must be provided',
})

export type GetPersonInput = z.infer<typeof getPersonSchema>

export async function getPerson(input: GetPersonInput) {
  let query = supabase
    .from('people')
    .select('id, full_name, slug, title, credentials, bio, linkedin_url, nysed_cert_id, cert_type, cert_subject, cert_status, cert_expires, source, metadata, created_at')

  if (input.person_id) query = query.eq('id', input.person_id)
  else query = query.eq('slug', input.slug!)

  const { data: person, error } = await query.single()
  if (error || !person) throw new Error('Person not found')

  // Fetch relationships + news + linked seller (for trust score)
  const [{ data: relationships }, { data: news }, { data: sellerRel }] = await Promise.all([
    supabase
      .from('relationships')
      .select('relationship, role, department, is_current, started_at, ended_at, target_id')
      .eq('source_type', 'person')
      .eq('source_id', person.id)
      .eq('target_type', 'seller')
      .order('is_current', { ascending: false })
      .limit(20),
    supabase
      .from('news_mentions')
      .select('headline, summary, article_url, source_name, published_at, sentiment, category')
      .eq('person_id', person.id)
      .order('published_at', { ascending: false })
      .limit(10),
    supabase
      .from('relationships')
      .select('target_id')
      .eq('source_type', 'person')
      .eq('source_id', person.id)
      .eq('relationship', 'operates_as')
      .eq('is_current', true)
      .limit(1),
  ])

  // Fetch linked seller for trust score + verifications
  let linkedSeller: { trust_score: number; slug: string; m8ven_id: string } | null = null
  let sellerVerifications: string[] = []
  if (sellerRel && sellerRel.length > 0) {
    const [{ data: sellerData }, { data: vers }] = await Promise.all([
      supabase.from('sellers')
        .select('trust_score, slug, m8ven_id')
        .eq('id', sellerRel[0].target_id)
        .single(),
      supabase.from('verifications')
        .select('type')
        .eq('seller_id', sellerRel[0].target_id)
        .eq('status', 'verified'),
    ])
    if (sellerData) linkedSeller = sellerData
    sellerVerifications = (vers ?? []).map(v => v.type)
  }

  // Fetch employer details separately (polymorphic FK)
  const employerIds = (relationships ?? [])
    .filter(r => r.relationship !== 'operates_as')
    .map(r => r.target_id)
  let employerMap = new Map<string, { display_name: string; slug: string; trust_score: number }>()
  if (employerIds.length > 0) {
    const { data: employers } = await supabase.from('sellers')
      .select('id, display_name, slug, trust_score')
      .in('id', employerIds)
    if (employers) {
      employerMap = new Map(employers.map(e => [e.id, e]))
    }
  }

  const employment = (relationships ?? [])
    .filter(r => r.relationship !== 'operates_as')
    .map(r => {
      const employer = employerMap.get(r.target_id)
      return {
        relationship: r.relationship,
        role: r.role,
        department: r.department,
        is_current: r.is_current,
        started_at: r.started_at,
        ended_at: r.ended_at,
        employer: employer ? {
          display_name: employer.display_name,
          slug: employer.slug,
          passport_url: `${APP_BASE_URL}/seller/${employer.slug}`,
          trust_score: employer.trust_score,
        } : null,
      }
    })

  const meta = person.metadata as Record<string, any> ?? {}

  return {
    id: person.id,
    full_name: person.full_name,
    slug: person.slug,
    title: person.title,
    credentials: person.credentials,
    bio: person.bio,
    linkedin_url: person.linkedin_url,
    certification: person.nysed_cert_id ? {
      cert_id: person.nysed_cert_id,
      type: person.cert_type,
      subject: person.cert_subject,
      status: person.cert_status,
      expires: person.cert_expires,
    } : undefined,
    role: meta.role,
    subjects: meta.subjects,
    // Marketplace fields (002-A)
    ...(meta.rate_per_hour != null ? { rate_per_hour: meta.rate_per_hour } : {}),
    ...(meta.years_experience != null ? { years_experience: meta.years_experience } : {}),
    ...(meta.school_specializations ? { school_specializations: meta.school_specializations } : {}),
    ...(meta.outcome_summary ? { outcome_summary: meta.outcome_summary } : {}),
    ...(meta.booking_url ? { booking_url: meta.booking_url } : {}),
    ...(meta.source_platform ? { source_platform: meta.source_platform } : {}),
    // Trust & verifications (from linked seller)
    ...(linkedSeller ? {
      trust_score: linkedSeller.trust_score,
      m8ven_id: linkedSeller.m8ven_id,
      passport_url: `${APP_BASE_URL}/seller/${linkedSeller.slug}`,
      verifications: sellerVerifications,
    } : {}),
    employment_history: employment,
    news: (news ?? []).map(n => ({
      headline: n.headline,
      summary: n.summary,
      url: n.article_url,
      source: n.source_name,
      published_at: n.published_at,
      sentiment: n.sentiment,
    })),
    member_since: person.created_at,
  }
}
