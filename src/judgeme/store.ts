import type { Database } from '../db.js';
import type { Review, ReviewsPanel } from './model.js';
import { waitingReviews } from './model.js';
import { appConfig } from '../config.js';

/** Commit the readable rows and notice atomically; only a clean poll proves a cached row was removed. */
export async function saveReviews(db: Database, reviews: readonly Review[], now: Date, unreadCount = 0): Promise<void> {
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO pulse.judgeme_reviews
      (review_id, rating, product_title, product_handle, market, verified_buyer, photo_count, body, created_at, published, hidden, curated, flagged, review_source, last_seen_at)
      SELECT id, rating, product_title, product_handle, market, verified_buyer, photo_count, body, created_at, published, hidden, curated, flagged, review_source, $2
      FROM jsonb_to_recordset($1::jsonb) AS r(id text, rating integer, product_title text, product_handle text, market text,
        verified_buyer boolean, photo_count integer, body text, created_at timestamptz, published boolean, hidden boolean, curated text, flagged boolean, review_source text)
      ON CONFLICT (review_id) DO UPDATE SET rating = EXCLUDED.rating, product_title = EXCLUDED.product_title,
        product_handle = EXCLUDED.product_handle, market = EXCLUDED.market, verified_buyer = EXCLUDED.verified_buyer,
        photo_count = EXCLUDED.photo_count, body = EXCLUDED.body, created_at = EXCLUDED.created_at,
        published = EXCLUDED.published, hidden = EXCLUDED.hidden, curated = EXCLUDED.curated, flagged = EXCLUDED.flagged, review_source = EXCLUDED.review_source, last_seen_at = EXCLUDED.last_seen_at`,
    [JSON.stringify(reviews.map(r => ({ id: r.id, rating: r.rating, product_title: r.productTitle, product_handle: r.productHandle,
      market: r.market, verified_buyer: r.verifiedBuyer, photo_count: r.photoCount, body: r.body, created_at: r.createdAt,
      published: r.published, hidden: r.hidden, curated: r.curated, flagged: r.flagged, review_source: r.source }))), now]);
    if (unreadCount === 0) {
      await tx.query('DELETE FROM pulse.judgeme_reviews WHERE NOT (review_id = ANY($1::text[]))', [reviews.map(r => r.id)]);
    }
    await tx.query(`INSERT INTO pulse.judgeme_sync (singleton, unread_count) VALUES (true, $1)
      ON CONFLICT (singleton) DO UPDATE SET unread_count = EXCLUDED.unread_count`, [unreadCount]);
    await tx.query(`UPDATE pulse.source_health SET status = 'healthy', last_success_at = $1, last_attempt_at = $1,
      consecutive_failures = 0, updated_at = $1 WHERE source = 'judgeme' AND mode = 'live'`, [now]);
  });
}

export async function readReviews(db: Database, now: Date): Promise<ReviewsPanel> {
  const health = (await db.query<{ status: string; last_success_at: Date | null; unread_count: number }>(
    `SELECT status, last_success_at, COALESCE((SELECT unread_count FROM pulse.judgeme_sync), 0) AS unread_count
      FROM pulse.source_health WHERE source = 'judgeme'`,
  )).rows[0];
  const rows = await db.query<{ review_id: string; rating: number; product_title: string; product_handle: string; market: string | null;
    verified_buyer: boolean; photo_count: number; body: string; created_at: Date; curated: Review['curated']; published: boolean; hidden: boolean; flagged: boolean | null; review_source: string | null }>(
    'SELECT * FROM pulse.judgeme_reviews WHERE NOT published AND NOT hidden',
  );
  // Ages display whole minutes; do not make unchanged SSE snapshots differ every millisecond.
  return { mode: 'live', asOf: new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString(), publishEnabled: appConfig.judgeme.publishEnabled,
    checkedAt: health?.last_success_at?.toISOString() ?? null,
    unreadCount: health?.unread_count ?? 0,
    status: health?.status === 'healthy' ? 'live' : health?.status === 'error' ? 'unavailable' : 'pending',
    rows: waitingReviews(rows.rows.map(r => ({ id: r.review_id, rating: r.rating, productTitle: r.product_title,
      productHandle: r.product_handle, market: r.market, verifiedBuyer: r.verified_buyer, photoCount: r.photo_count,
      body: r.body, createdAt: r.created_at.toISOString(), published: r.published, hidden: r.hidden, curated: r.curated, flagged: r.flagged, source: r.review_source }))),
  };
}

export interface ReviewHealth {read:number;waiting:number;flagged:number;last:string|null;mode:'live'|'sample'}
export async function readReviewHealth(db:Database):Promise<ReviewHealth>{
  const row=(await db.query<{read:string;waiting:string;flagged:string}>(`SELECT count(*) AS read,
    count(*) FILTER(WHERE NOT published AND NOT hidden) AS waiting,
    count(*) FILTER(WHERE NOT published AND NOT hidden AND flagged) AS flagged FROM pulse.judgeme_reviews`)).rows[0]!;
  const last=(await db.query<{last_success_at:Date|null}>("SELECT last_success_at FROM pulse.source_health WHERE source='judgeme'")).rows[0]?.last_success_at;
  return {read:Number(row.read),waiting:Number(row.waiting),flagged:Number(row.flagged),last:last?.toISOString()??null,mode:'live'};
}
