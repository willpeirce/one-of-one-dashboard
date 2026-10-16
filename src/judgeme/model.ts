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
  flagged: boolean | null;
  source: string | null;
  curated: 'ok' | 'spam' | 'not-yet';
}

export interface ReviewsPanel {
  mode: 'sample' | 'live';
  rows: Review[];
  checkedAt: string | null;
  status: 'waiting_for_keys' | 'pending' | 'live' | 'unavailable';
  publishEnabled: boolean;
  unreadCount: number;
  asOf: string;
}

export function waitingReviews(rows: readonly Review[]): Review[] {
  return rows.filter(row => !row.published && !row.hidden).sort((a, b) =>
    Number(a.flagged === true) - Number(b.flagged === true) || Number(b.rating <= 3) - Number(a.rating <= 3) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Explicit allowlist: v1 reviewer, IP, photo URLs and other fields never leave the client. */
export function cleanReview(input: unknown): Review | null {
  const r = input as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Number.isSafeInteger(r.id) || Number(r.id) <= 0 || !Number.isInteger(r.rating)
    || Number(r.rating) < 1 || Number(r.rating) > 5 || typeof r.body !== 'string'
    || typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))
    || typeof r.curated !== 'string' || !['ok', 'spam', 'not-yet'].includes(r.curated) || typeof r.hidden !== 'boolean'
    || typeof r.published !== 'boolean'
    || !Array.isArray(r.pictures)) return null;
  // PostgreSQL text/jsonb rejects NUL and lone surrogates; keep one bad value out of the batch.
  if ([r.body, r.product_title, r.product_handle].some(value => typeof value === 'string' && /[\u0000\uD800-\uDFFF]/u.test(value))) return null;
  const created = new Date(r.created_at);
  if (created.getUTCFullYear() < 1 || created.getUTCFullYear() > 9999) return null;
  const curated = r.curated as Review['curated'];
  return {
    id: String(r.id), rating: Number(r.rating), body: r.body,
    productTitle: typeof r.product_title === 'string' ? r.product_title : 'Store review',
    productHandle: typeof r.product_handle === 'string' ? r.product_handle : '',
    // The documented v1 review response has no country field. Never infer it from an IP.
    market: null, verifiedBuyer: r.verified === 'buyer', photoCount: r.pictures.length,
    createdAt: created.toISOString(), curated,
    published: r.published, hidden: r.hidden, flagged: curated === 'spam',
    source: typeof r.source === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(r.source) ? r.source : null,
  };
}
