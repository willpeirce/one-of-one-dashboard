const selectedIdPattern = /^\d{5,25}$/;

export class AdSetSelectionError extends Error {
  readonly statusCode = 400;
  constructor() { super('Invalid ad-set selection.'); }
}

/** Selection only broadens this stored read by one row; it grants no source action. */
export function selectedAdSetId(query: unknown): string | undefined {
  if (!query || typeof query !== 'object' || Array.isArray(query) || !Object.hasOwn(query, 'set')) return undefined;
  const value = (query as {set?: unknown}).set;
  if (typeof value !== 'string' || !selectedIdPattern.test(value)) throw new AdSetSelectionError();
  return value;
}

/** Keep an explicitly opened inactive set present after refresh or a local flag save. */
export function selectedAdSetsApiPath(search: string): string {
  const values = new URLSearchParams(search).getAll('set');
  return values.length === 1 && selectedIdPattern.test(values[0]!)
    ? `/api/meta/adsets?set=${encodeURIComponent(values[0]!)}` : '/api/meta/adsets';
}
