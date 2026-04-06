import { z } from 'zod'
import { supabase } from '../lib/supabase.js'

export const getSellerProductsSchema = z.object({
  seller_id: z.string().uuid().optional().describe('Seller UUID'),
  slug: z.string().optional().describe('Seller slug (URL-friendly name)'),
  category: z.string().optional().describe('Filter by product category (e.g. "sneakers")'),
  brand: z.string().optional().describe('Filter by brand (e.g. "Nike", "Jordan")'),
  limit: z.number().min(1).max(50).optional().default(20).describe('Max products to return'),
}).refine(data => data.seller_id || data.slug, {
  message: 'Either seller_id or slug must be provided',
})

export type GetSellerProductsInput = z.infer<typeof getSellerProductsSchema>

export async function getSellerProducts(input: GetSellerProductsInput) {
  // Resolve seller_id from slug if needed
  let sellerId = input.seller_id
  let sellerName: string | null = null

  if (!sellerId) {
    const { data: seller, error } = await supabase
      .from('sellers')
      .select('id, display_name')
      .eq('slug', input.slug!)
      .single()
    if (error || !seller) throw new Error('Seller not found')
    sellerId = seller.id
    sellerName = seller.display_name
  }

  let query = supabase
    .from('seller_products')
    .select('id, title, brand, sku, price_cents, currency, image_url, product_url, category, in_stock, attributes')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(input.limit)

  if (input.category) {
    query = query.eq('category', input.category)
  }
  if (input.brand) {
    query = query.ilike('brand', input.brand)
  }

  const { data: products, error } = await query
  if (error) throw new Error(`Failed to fetch products: ${error.message}`)

  // If we didn't get sellerName from slug lookup, fetch it
  if (!sellerName && sellerId) {
    const { data: seller } = await supabase
      .from('sellers')
      .select('display_name')
      .eq('id', sellerId)
      .single()
    sellerName = seller?.display_name ?? null
  }

  return {
    seller_name: sellerName,
    product_count: products?.length ?? 0,
    products: (products ?? []).map(p => ({
      title: p.title,
      brand: p.brand,
      sku: p.sku,
      price: `$${(p.price_cents / 100).toFixed(2)}`,
      price_cents: p.price_cents,
      currency: p.currency,
      image_url: p.image_url,
      product_url: p.product_url,
      category: p.category,
      in_stock: p.in_stock,
      attributes: p.attributes,
    })),
  }
}
