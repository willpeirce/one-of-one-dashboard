import type { Database } from '../db.js';
import type { Review, ReviewsPanel } from './model.js';
import { waitingReviews } from './model.js';
import { appConfig } from '../config.js';

/** Commit a complete paginated poll atomically, including removals and review moderation changes. */
export async function saveReviews(db: Database, reviews: readonly Review[], now: Date): Promise<void> {
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO pulse.judgeme_reviews
      (review_id, rating, product_title, product_handle, market, verified_buyer, photo_count, body, created_at, published, hidden, curated, last_seen_at)
      SELECT id, rating, product_title, product_handle, market, verified_buyer, photo_count, body, created_at, published, hidden, curated, $2
      FROM jsonb_to_recordset($1::jsonb) AS r(id text, rating integer, product_title text, product_handle text, market text,
        verified_buyer boolean, photo_count integer, body text, created_at timestamptz, published boolean, hidden boolean, curated text)
      ON CONFLICT (review_id) DO UPDATE SET rating = EXCLUDED.rating, product_title = EXCLUDED.product_title,
        product_handle = EXCLUDED.product_handle, market = EXCLUDED.market, verified_buyer = EXCLUDED.verified_buyer,
        photo_count = EXCLUDED.photo_count, body = EXCLUDED.body, created_at = EXCLUDED.created_at,
        published = EXCLUDED.published, hidden = EXCLUDED.hidden, curated = EXCLUDED.curated, last_seen_at = EXCLUDED.last_seen_at`,
    [JSON.stringify(reviews.map(r => ({ id: r.id, rating: r.rating, product_title: r.productTitle, product_handle: r.productHandle,
      market: r.market, verified_buyer: r.verifiedBuyer, photo_count: r.photoCount, body: r.body, created_at: r.createdAt,
      published: r.published, hidden: r.hidden, curated: r.curated }))), now]);
    await tx.query('DELETE FROM pulse.judgeme_reviews WHERE NOT (review_id = ANY($1::text[]))', [reviews.map(r => r.id)]);
    await tx.query(`UPDATE pulse.source_health SET status = 'healthy', last_success_at = $1, last_attempt_at = $1,
      consecutive_failures = 0, updated_at = $1 WHERE source = 'judgeme' AND mode = 'live'`, [now]);
  });
}

export async function readReviews(db: Database, now: Date): Promise<ReviewsPanel> {
  const health = (await db.query<{ status: string; last_success_at: Date | null }>(
    "SELECT status, last_success_at FROM pulse.source_health WHERE source = 'judgeme'",
  )).rows[0];
  const rows = await db.query<{ review_id: string; rating: number; product_title: string; product_handle: string; market: string | null;
    verified_buyer: boolean; photo_count: number; body: string; created_at: Date; curated: Review['curated']; published: boolean; hidden: boolean }>(
    'SELECT * FROM pulse.judgeme_reviews WHERE NOT published AND NOT hidden',
  );
  // Ages display whole minutes; do not make unchanged SSE snapshots differ every millisecond.
  return { mode: 'live', asOf: new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString(), publishEnabled: appConfig.judgeme.publishEnabled,
    checkedAt: health?.last_success_at?.toISOString() ?? null,
    status: health?.status === 'healthy' ? 'live' : health?.status === 'error' ? 'unavailable' : 'pending',
    rows: waitingReviews(rows.rows.map(r => ({ id: r.review_id, rating: r.rating, productTitle: r.product_title,
      productHandle: r.product_handle, market: r.market, verifiedBuyer: r.verified_buyer, photoCount: r.photo_count,
      body: r.body, createdAt: r.created_at.toISOString(), published: r.published, hidden: r.hidden, curated: r.curated }))),
  };
}
