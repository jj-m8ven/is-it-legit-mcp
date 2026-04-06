import { z } from 'zod'

export const getPricingSchema = z.object({
  product: z.enum(['all', 'seller', 'buyer', 'data_api', 'chat_api']).optional()
    .describe('Which product pricing to return. Defaults to all.'),
})

export type GetPricingInput = z.infer<typeof getPricingSchema>

const SELLER_PRICING = {
  passport: { price: 20, period: 'year', description: 'Verified trust passport for your business' },
}

const BUYER_PLANS = {
  buyer_free: {
    name: 'Free',
    price: 0,
    period: null,
    dailyLimit: 10,
    features: ['10 lookups/day', '3 watchlist slots', 'Basic alerts'],
  },
  buyer_plus: {
    name: 'Plus',
    price: 5,
    period: 'month',
    dailyLimit: null,
    features: ['Unlimited lookups', '20 watchlist slots', 'All alert types', 'Search history', '50 AI chats/day'],
  },
}

const DATA_API_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    period: null,
    perRequest: null,
    dailyLimit: 100,
    description: 'For testing and evaluation',
    features: ['100 requests/day', 'All MCP tools', 'Community support'],
  },
  starter: {
    name: 'Starter',
    price: 49,
    period: 'month',
    perRequest: null,
    monthlyIncluded: 30000,
    overageRate: 0.005,
    dailyLimit: 1000,
    description: 'For small projects and prototypes',
    features: ['30k requests/mo included', '$0.005/req overage', 'All MCP tools', 'Email support'],
  },
  growth: {
    name: 'Growth',
    price: 149,
    period: 'month',
    perRequest: null,
    monthlyIncluded: 300000,
    overageRate: 0.003,
    dailyLimit: 10000,
    description: 'For production applications',
    features: ['300k requests/mo included', '$0.003/req overage', 'All MCP tools', 'Priority support'],
  },
  payg: {
    name: 'Pay As You Go',
    price: 0,
    period: null,
    perRequest: 0.005,
    dailyLimit: null,
    description: 'Pay only for what you use',
    features: ['Unlimited requests', 'All MCP tools', 'Spending cap control', 'Priority support'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 0,
    period: null,
    perRequest: null,
    dailyLimit: null,
    description: 'Custom pricing for large-scale usage',
    features: ['Unlimited requests', 'Dedicated support', 'Custom SLA', 'SSO'],
  },
}

const CHAT_API_PLANS = {
  chat_free: {
    name: 'Chat Free',
    price: 0,
    period: null,
    perMessage: null,
    dailyLimit: 50,
    description: 'For testing chat integration',
    features: ['50 messages/day', 'All tools', 'Community support'],
  },
  chat_starter: {
    name: 'Chat Starter',
    price: 99,
    period: 'month',
    perMessage: null,
    monthlyIncluded: 15000,
    overageRate: 0.01,
    dailyLimit: null,
    description: 'Embed M8ven chat in your app',
    features: ['15k messages/mo included', '$0.01/msg overage', 'All tools', 'Email support'],
  },
  chat_growth: {
    name: 'Chat Growth',
    price: 299,
    period: 'month',
    perMessage: null,
    monthlyIncluded: 150000,
    overageRate: 0.006,
    dailyLimit: null,
    description: 'High-volume chat integration',
    features: ['150k messages/mo included', '$0.006/msg overage', 'All tools', 'Priority support', 'Custom system prompt'],
  },
  chat_payg: {
    name: 'Chat Pay As You Go',
    price: 0,
    period: null,
    perMessage: 0.01,
    dailyLimit: null,
    description: 'Pay per chat message',
    features: ['Unlimited messages', 'Spending cap control', 'Priority support'],
  },
}

export async function getPricing(input: GetPricingInput) {
  const product = input.product || 'all'

  if (product === 'seller') return { seller: SELLER_PRICING }
  if (product === 'buyer') return { buyer: BUYER_PLANS }
  if (product === 'data_api') return { data_api: DATA_API_PLANS }
  if (product === 'chat_api') return { chat_api: CHAT_API_PLANS }

  return {
    seller: SELLER_PRICING,
    buyer: BUYER_PLANS,
    data_api: DATA_API_PLANS,
    chat_api: CHAT_API_PLANS,
  }
}
