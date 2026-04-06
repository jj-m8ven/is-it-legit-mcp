import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const listCategoriesSchema = z.object({
  parent_slug: z.string().optional().describe('Parent category slug to list children of. Omit for top-level categories.'),
})

export type ListCategoriesInput = z.infer<typeof listCategoriesSchema>

interface CategoryResult {
  slug: string
  name: string
  parent_slug: string | null
  seller_count: number
  children?: CategoryResult[]
}

export async function listCategories(input: ListCategoriesInput): Promise<{ categories: CategoryResult[] }> {
  // Fetch all categories
  const { data: allCategories, error } = await supabase
    .from('categories')
    .select('id, slug, name, parent_id')
    .order('name')

  if (error) throw new Error(`Failed to fetch categories: ${error.message}`)
  if (!allCategories) return { categories: [] }

  // Fetch seller counts per category
  const { data: counts } = await supabase
    .from('seller_categories')
    .select('category_id')

  const countMap = new Map<string, number>()
  for (const row of counts ?? []) {
    countMap.set(row.category_id, (countMap.get(row.category_id) ?? 0) + 1)
  }

  // Build id -> category map
  const byId = new Map(allCategories.map(c => [c.id, c]))

  // Filter to requested scope
  let targetParentId: string | null = null
  if (input.parent_slug) {
    const parent = allCategories.find(c => c.slug === input.parent_slug)
    if (!parent) throw new Error(`Category not found: ${input.parent_slug}`)
    targetParentId = parent.id
  }

  const topLevel = allCategories.filter(c =>
    input.parent_slug ? c.parent_id === targetParentId : c.parent_id === null
  )

  const results: CategoryResult[] = topLevel.map(cat => {
    const children = allCategories.filter(c => c.parent_id === cat.id)
    const parentCat = cat.parent_id ? byId.get(cat.parent_id) : null

    // Count includes children
    let totalCount = countMap.get(cat.id) ?? 0
    for (const child of children) {
      totalCount += countMap.get(child.id) ?? 0
    }

    const result: CategoryResult = {
      slug: cat.slug,
      name: cat.name,
      parent_slug: parentCat?.slug ?? null,
      seller_count: totalCount,
    }

    // Include children if listing top-level
    if (!input.parent_slug && children.length > 0) {
      result.children = children.map(child => ({
        slug: child.slug,
        name: child.name,
        parent_slug: cat.slug,
        seller_count: countMap.get(child.id) ?? 0,
      }))
    }

    return result
  })

  return { categories: results }
}
