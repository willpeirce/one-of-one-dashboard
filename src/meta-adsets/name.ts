/** Keep the useful name: remove a type/campaign prefix and a standalone budget suffix. */
export function adSetName(name: string): string {
  const parts = name.split(/\s*[-–—]\s*/);
  const kept = parts.length >= 3 ? parts.slice(1) : [...parts];
  if (/^(?:[£$€]\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:GBP|USD|EUR))$/i.test(kept.at(-1)?.trim() ?? '')) kept.pop();
  if (kept.length === parts.length) return name;
  const trimmed = kept.join(' — ').trim();
  return trimmed.length < 4 ? name : trimmed;
}
