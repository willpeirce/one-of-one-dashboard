import type { CreativeAd, MediaGroup } from './model.js';

export type AttributeSource = 'meta' | 'model' | 'will';
export type CreativeKind = MediaGroup['kind'];
export interface AttributeOption { value: string; label: string }
export interface AttributeDefinition {
  key: string; label: string; values: readonly AttributeOption[]; sources: readonly AttributeSource[];
}
export interface AttributeRow {
  groupId: string; key: string; source: AttributeSource; value: unknown; recordedAt?: string;
}
export interface AttributeValue { value: string; confidence?: number; reason?: string }
export interface ResolvedAttribute {
  key: string; label: string; values: readonly AttributeOption[]; value: string | null;
  valueLabel: string; source: AttributeSource | null; confidence: number | null;
  unsure: boolean; willValue: string | null;
}

const options = (...values: (string | readonly [string, string])[]): AttributeOption[] =>
  values.map(value => typeof value === 'string' ? { value, label: value } : { value: value[0], label: value[1] });
const yesNo = options('yes', 'no');
const visual: readonly AttributeSource[] = ['model', 'will'];
const facts: readonly AttributeSource[] = ['meta', 'will'];
const define = (key: string, label: string, values: readonly AttributeOption[], sources: readonly AttributeSource[] = visual): AttributeDefinition => ({ key, label, values, sources });
const audience = options('parents', 'collectors', 'kids', 'gift');
const themes = options('animals', 'fantasy', 'space', 'sport', 'vehicles', ['mixed', 'mixed themes'], 'other', ['none', 'no theme shown']);
const slabs = options('0', '1', '2', ['3-plus', '3 or more']);
const sharedFacts: readonly AttributeDefinition[] = [
  define('aspect', 'Aspect', options('portrait', 'square', 'landscape'), facts),
  define('copyPrice', 'Copy mentions a price', yesNo, facts),
  define('copyOffer', 'Copy mentions an offer', yesNo, facts),
  define('copyStencils', 'Copy mentions stencils', yesNo, facts),
  define('copyMarkers', 'Copy mentions markers', yesNo, facts),
  define('callToAction', 'Call to action', options(
    ['SHOP_NOW', 'shop now'], ['LEARN_MORE', 'learn more'], ['BUY_NOW', 'buy now'],
    ['GET_OFFER', 'get offer'], ['ORDER_NOW', 'order now'], ['SIGN_UP', 'sign up'],
    ['SUBSCRIBE', 'subscribe'], ['CONTACT_US', 'contact us'], ['SEND_MESSAGE', 'send message'],
    ['MESSAGE_PAGE', 'send message'], ['WATCH_MORE', 'watch more'], ['DOWNLOAD', 'download'],
    ['BOOK_NOW', 'book now'], ['APPLY_NOW', 'apply now'], ['GET_QUOTE', 'get quote'],
    ['NO_BUTTON', 'no button'], ['NONE', 'none'], ['OTHER', 'other']), facts),
  define('placementCustomised', 'Placement customised', yesNo, facts),
];

/** The only accepted attribute keys and values, shared by tagging, scans and lifts. */
export const attributeSchema: Record<CreativeKind, readonly AttributeDefinition[]> = {
  video: [
    define('type', 'Type', options('video'), facts),
    define('lengthBand', 'Length', options(['under-10', 'under 10 s'], ['10-20', '10 to 20 s'], ['20-40', '20 to 40 s'], ['over-40', 'over 40 s']), facts),
    ...sharedFacts,
    define('hookType', 'Hook', options('question', 'claim', 'reveal', 'reaction', 'unboxing', 'other')),
    define('productEarly', 'Product in the first 3 seconds', yesNo),
    define('slabEarly', 'Slab in the first 3 seconds', yesNo),
    define('slabsShown', 'Slabs shown', slabs),
    define('boxShown', 'Box shown', yesNo),
    define('stencilsMentioned', 'Stencils mentioned', yesNo, ['meta', 'model', 'will']),
    define('markersShown', 'Markers shown', yesNo),
    define('childInShot', 'Child in shot', yesNo),
    define('whoSpeaks', 'Who speaks', options('creator', 'founder', 'nobody'), ['will']),
    define('captions', 'Captions', yesNo),
    define('voiceOver', 'Voice-over', yesNo, ['will']),
    define('music', 'Music', yesNo, ['will']),
    define('spokenCallToAction', 'Call to action spoken', yesNo, ['will']),
    define('priceOrOffer', 'Price or offer mentioned', yesNo, ['meta', 'model', 'will']),
    define('setting', 'Setting', options(['kitchen-table', 'kitchen table'], 'bedroom', 'outdoors', 'studio', 'other')),
    define('audienceFraming', 'Audience framing', audience),
    define('cardTheme', 'Card theme shown', themes),
    define('firstSeen', 'Product or person first', options(['product', 'product first'], ['person', 'person first'])),
  ],
  image: [
    define('type', 'Type', options('image'), facts),
    ...sharedFacts,
    define('format', 'Format', options(
      ['text-read', 'text read'], ['toy-catalogue-page', 'toy catalogue page'], ['news-article', 'news article'],
      ['bulleted-list', 'bulleted list'], 'screenshot', ['ugc-photo', 'UGC photo'], ['offer-first-banner', 'offer-first banner'],
      ['founder-letter', 'founder letter'], ['unboxing-flat-lay', 'unboxing flat lay'], ['3-reasons-listicle', '3 reasons listicle'],
      ['split-screen', 'split screen'], ['text-on-object', 'text on the object'], ['3-step-demo', '3-step demo'],
      ['customer-card-montage', 'customer card montage'], ['social-thread', 'social thread'], ['till-receipt', 'till receipt'],
      ['nutrition-label', 'nutrition label'], ['price-per-hour', 'price per hour'], ['gift-guide', 'gift guide'],
      ['christmas-morning', 'Christmas morning'], ['tier-list', 'tier list'], ['venn-diagram', 'Venn diagram'], 'other')),
    define('productInShot', 'Product in shot', yesNo),
    define('slabsShown', 'Slabs shown', slabs),
    define('audienceFraming', 'Audience framing', audience),
    define('cardTheme', 'Card theme', themes),
    define('textDensity', 'Text density', options('none', ['one-line', 'one line'], 'heavy')),
    define('offerLine', 'Offer line', yesNo),
    define('priceShown', 'Price shown', yesNo),
    define('imageType', 'Picture type', options('photo', 'render', 'generated')),
    define('colourMood', 'Colour mood', options('dark', 'light', 'bright')),
    define('childInShot', 'Child in shot', yesNo),
    define('stencilsShown', 'Stencils shown', yesNo),
    define('boxShown', 'Box shown', yesNo),
  ],
};

export const copyWordLists = {
  price: ['price'], offer: ['off', 'free', 'save', 'offer', 'code', 'discount'],
  stencils: ['stencil', 'stencils'], markers: ['marker', 'markers'],
} as const;
export const attributesForKind = (kind: CreativeKind): readonly AttributeDefinition[] => attributeSchema[kind];

export function validAttributeValue(kind: CreativeKind, key: string, source: AttributeSource, input: unknown): AttributeValue | null {
  const definition = attributeSchema[kind].find(attribute => attribute.key === key);
  if (!definition?.sources.includes(source)) return null;
  const object = input != null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const value = typeof input === 'string' ? input : object?.value;
  if (typeof value !== 'string' || !definition.values.some(option => option.value === value)) return null;
  if (source === 'model') {
    const confidence = object?.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    const reason = typeof object?.reason === 'string' ? object.reason.replace(/[\r\n]+/g, ' ').slice(0, 300) : '';
    return { value, confidence, reason };
  }
  return { value };
}

export function validateAttributeValues(kind: CreativeKind, source: AttributeSource, input: unknown): { values: Record<string, AttributeValue>; dropped: number } {
  const values: Record<string, AttributeValue> = {};
  let dropped = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { values, dropped };
  for (const [key, candidate] of Object.entries(input)) {
    const value = validAttributeValue(kind, key, source, candidate);
    if (value) values[key] = value;
    else dropped += 1;
  }
  return { values, dropped };
}

/** An unsure model answer deliberately blocks a Meta fallback, and has no lift value. */
export function resolveAttribute(kind: CreativeKind, key: string, rows: readonly AttributeRow[]): ResolvedAttribute | null {
  const definition = attributeSchema[kind].find(attribute => attribute.key === key);
  if (!definition) return null;
  const valid = (source: AttributeSource): AttributeValue | null => {
    const candidates = rows.filter(row => row.key === key && row.source === source)
      .sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
    for (const row of candidates) {
      const value = validAttributeValue(kind, key, source, row.value);
      if (value) return value;
    }
    return null;
  };
  const will = valid('will');
  for (const source of ['will', 'model', 'meta'] as const) {
    const answer = source === 'will' ? will : valid(source);
    if (!answer) continue;
    const unsure = source === 'model' && answer.confidence! < 0.5;
    return { key, label: definition.label, values: definition.values, value: unsure ? null : answer.value,
      valueLabel: unsure ? 'unsure' : definition.values.find(option => option.value === answer.value)!.label,
      source, confidence: answer.confidence ?? null, unsure, willValue: will?.value ?? null };
  }
  return { key, label: definition.label, values: definition.values, value: null, valueLabel: 'not scanned yet', source: null, confidence: null, unsure: false, willValue: null };
}

export function resolveAttributes(kind: CreativeKind, rows: readonly AttributeRow[]): ResolvedAttribute[] {
  return attributeSchema[kind].map(attribute => resolveAttribute(kind, attribute.key, rows)!);
}

/** Callers supply the parent's ads, including ads attached to merged children. */
export function deterministicAttributeValues(group: Pick<MediaGroup, 'kind' | 'lengthSeconds' | 'width' | 'height' | 'alternates'>,
  ads: readonly Pick<CreativeAd, 'id' | 'createdAt' | 'body' | 'title' | 'callToAction'>[]): Record<string, string> {
  const newest = [...ads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
  const copy = newest ? `${newest.body}\n${newest.title}` : '';
  const mentions = (words: readonly string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'i').test(copy);
  const yes = (value: boolean) => value ? 'yes' : 'no';
  const price = /\p{Sc}/u.test(copy) || mentions(copyWordLists.price);
  const offer = mentions(copyWordLists.offer);
  const values: Record<string, string> = { type: group.kind, copyPrice: yes(price), copyOffer: yes(offer),
    copyStencils: yes(mentions(copyWordLists.stencils)), copyMarkers: yes(mentions(copyWordLists.markers)),
    placementCustomised: yes(group.alternates.length > 0) };
  if (group.width != null && group.height != null && group.width > 0 && group.height > 0) {
    values.aspect = group.width === group.height ? 'square' : group.width < group.height ? 'portrait' : 'landscape';
  }
  if (group.kind === 'video') {
    const seconds = group.lengthSeconds;
    if (seconds != null && Number.isFinite(seconds) && seconds >= 0) values.lengthBand = seconds < 10 ? 'under-10' : seconds < 20 ? '10-20' : seconds <= 40 ? '20-40' : 'over-40';
    values.stencilsMentioned = values.copyStencils!;
    values.priceOrOffer = yes(price || offer);
  }
  if (newest) {
    const cta = newest.callToAction || 'NONE';
    values.callToAction = attributeSchema[group.kind].find(attribute => attribute.key === 'callToAction')!.values.some(option => option.value === cta) ? cta : 'OTHER';
  }
  return values;
}
