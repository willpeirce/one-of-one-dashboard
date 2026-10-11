import { appConfig } from '../config.js';
import { cleanReview, waitingReviews, type ReviewsPanel } from './model.js';

// Invented v1-shaped examples, independent of live credentials and store figures.
export const sampleReviewResponse = {
  current_page: 1, per_page: 100,
  reviews: [
    { id: 900101, rating: 2, product_title: 'Sample Duo Pack', product_handle: 'sample-duo-pack', verified: 'buyer', pictures: [{}],
      body: 'The sample box arrived with a bent corner. The pieces inside were fine, but I would like sturdier packaging next time.',
      created_at: '2026-09-30T09:00:00Z', curated: 'not-yet', hidden: false },
    { id: 900102, rating: 5, product_title: 'Sample Kit', product_handle: 'sample-kit', verified: 'buyer', pictures: [],
      body: 'An enjoyable sample afternoon making cards. The instructions were easy to follow and the finished cards look lovely.',
      created_at: '2026-09-30T10:00:00Z', curated: 'not-yet', hidden: false },
    { id: 900103, rating: 4, product_title: 'Sample Refill Pack', product_handle: 'sample-refill', verified: '', pictures: [{}, {}],
      body: 'The sample refill gave us another round of cards to decorate. I would have liked one more example in the guide.',
      created_at: '2026-09-27T12:00:00Z', curated: 'not-yet', hidden: false },
  ],
};
export function sampleReviews(): ReviewsPanel {
  return { mode: 'sample', status: 'waiting_for_keys', asOf: appConfig.shopify.sampleNow,
    checkedAt: null, publishEnabled: appConfig.judgeme.publishEnabled,
    rows: waitingReviews(sampleReviewResponse.reviews.map(cleanReview)) };
}
