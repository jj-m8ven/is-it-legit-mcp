import { z } from 'zod'

export const submitReviewSchema = z.object({
  seller_id: z.string().uuid().describe('Seller UUID'),
  rating: z.number().min(1).max(5).describe('Rating from 1 to 5'),
  title: z.string().optional().describe('Review title'),
  body: z.string().optional().describe('Review body'),
  platform: z.string().optional().describe('Platform where transaction occurred'),
})

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>

export async function submitReview(_input: SubmitReviewInput): Promise<{ message: string }> {
  return {
    message: 'Review submission is not yet available. This feature is coming in Phase 2. For now, reviews can be submitted through the M8ven website at https://m8ven.ai.',
  }
}
