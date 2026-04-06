import { createHash } from 'node:crypto'
import { supabase } from './supabase.js'
import type { McpApiKeyRow } from './types.js'

export async function validateApiKey(apiKey: string): Promise<McpApiKeyRow | null> {
  const keyHash = createHash('sha256').update(apiKey).digest('hex')

  const { data } = await supabase
    .from('mcp_api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (!data) return null

  // Check rate limit
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const { count } = await supabase
    .from('mcp_request_log')
    .select('*', { count: 'exact', head: true })
    .eq('api_key_id', data.id)
    .gte('created_at', oneMinuteAgo)

  if ((count ?? 0) >= data.rate_limit_per_minute) {
    return null // Rate limited
  }

  // Update last_used_at
  await supabase
    .from('mcp_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return data as McpApiKeyRow
}

export async function logRequest(apiKeyId: string, toolName: string, responseTimeMs: number, categorySlugsAccessed?: string[]) {
  await supabase.from('mcp_request_log').insert({
    api_key_id: apiKeyId,
    tool_name: toolName,
    response_time_ms: responseTimeMs,
    ...(categorySlugsAccessed && categorySlugsAccessed.length > 0 ? { category_slugs_accessed: categorySlugsAccessed } : {}),
  })
}
