export interface Review {
  id: string;
  rating: number;
  productTitle: string;
  productHandle: string;
  market: string | null;
  verifiedBuyer: boolean;
  photoCount: number;
  body: string;
  createdAt: string;
  published: boolean;
  hidden: boolean;
  curated: 'ok' | 'spam' | 'not-yet';
}

export interface ReviewsPanel {
  mode: 'sample' | 'live';
  rows: Review[];
  checkedAt: string | null;
  status: 'waiting_for_keys' | 'pending' | 'live' | 'unavailable';
  publishEnabled: boolean;
  asOf: string;
}

export function waitingReviews(rows: readonly Review[]): Review[] {
  return rows.filter(row => !row.published && !row.hidden).sort((a, b) =>
    Number(b.rating <= 3) - Number(a.rating <= 3) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Explicit allowlist: v1 reviewer, IP, photo URLs and other fields never leave the client. */
export function cleanReview(input: unknown): Review {
  const r = input as Record<string, unknown> | null;
  if (!r || !Number.isSafeInteger(r.id) || Number(r.id) <= 0 || !Number.isInteger(r.rating)
    || Number(r.rating) < 1 || Number(r.rating) > 5 || typeof r.body !== 'string'
    || typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))
    || !['ok', 'spam', 'not-yet'].includes(String(r.curated)) || typeof r.hidden !== 'boolean'
    || !Array.isArray(r.pictures)) throw new Error('Invalid review response');
  const curated = r.curated as Review['curated'];
  return {
    id: String(r.id), rating: Number(r.rating), body: r.body,
    productTitle: typeof r.product_title === 'string' ? r.product_title : 'Store review',
    productHandle: typeof r.product_handle === 'string' ? r.product_handle : '',
    // The documented v1 review response has no country field. Never infer it from an IP.
    market: null, verifiedBuyer: r.verified === 'buyer', photoCount: r.pictures.length,
    createdAt: new Date(r.created_at).toISOString(), curated,
    published: curated === 'ok', hidden: r.hidden || curated === 'spam',
  };
}
