import type { AttributeDefinition } from './attributes.js';

const yesNo = (yes: string, no: string) => ({ yes, no });
/** Instructions describe the winning value, including an explicit absence. */
export const liftPhrasing: Record<string, Record<string, string>> = {
  type: { video: 'Make a video', image: 'Make an image' },
  aspect: { portrait: 'Shoot portrait', square: 'Use a square frame', landscape: 'Shoot landscape' },
  lengthBand: { 'under-10': 'Keep it under 10 seconds', '10-20': 'Keep it between 10 and 20 seconds', '20-40': 'Keep it between 20 and 40 seconds', 'over-40': 'Give it over 40 seconds' },
  copyPrice: yesNo('Put the price in the text', 'Leave the price out of the text'),
  copyOffer: yesNo('Put the deal in the text', 'Leave the deal out of the text'),
  copyStencils: yesNo('Say stencils', 'Leave stencils out of the text'),
  copyMarkers: yesNo('Say markers', 'Leave markers out of the text'),
  placementCustomised: yesNo('Tailor it to each placement', 'Use the same creative across placements'),
  callToAction: {
    SHOP_NOW: 'Ask people to shop now', LEARN_MORE: 'Invite people to learn more', BUY_NOW: 'Ask people to buy now',
    GET_OFFER: 'Invite people to get the offer', ORDER_NOW: 'Ask people to order now', SIGN_UP: 'Ask people to sign up',
    SUBSCRIBE: 'Ask people to subscribe', CONTACT_US: 'Invite people to contact you', SEND_MESSAGE: 'Invite a message',
    MESSAGE_PAGE: 'Invite a message', WATCH_MORE: 'Invite people to watch more', DOWNLOAD: 'Offer a download',
    BOOK_NOW: 'Ask people to book now', APPLY_NOW: 'Invite people to apply now', GET_QUOTE: 'Offer a quote',
    NO_BUTTON: 'Leave the button out', NONE: 'Leave the call to action out', OTHER: 'Try another call to action',
  },
  hookType: { question: 'Open with a question', claim: 'Open with a claim', reveal: 'Open with a reveal', reaction: 'Open with a reaction', unboxing: 'Open with an unboxing', other: 'Try another opening' },
  productEarly: yesNo('Product on screen in the first 3 seconds', 'Save the product for after the first 3 seconds'),
  slabEarly: yesNo('Slab on screen in the first 3 seconds', 'Save the slab for after the first 3 seconds'),
  slabsShown: { '0': 'Leave slabs out of shot', '1': 'Show one slab', '2': 'Show two slabs', '3-plus': 'Show three or more slabs' },
  boxShown: yesNo('Show the box', 'No box on screen'),
  stencilsMentioned: yesNo('Mention stencils', 'Leave stencils unmentioned'),
  markersShown: yesNo('Show the markers', 'Leave markers out of shot'),
  childInShot: yesNo('Include a child in shot', 'Leave children out of shot'),
  whoSpeaks: { creator: 'Let the creator speak', founder: 'Let the founder speak', nobody: 'Let the pictures speak' },
  captions: yesNo('Add captions', 'Leave captions out'),
  voiceOver: yesNo('Add a voice-over', 'Leave the voice-over out'),
  music: yesNo('Add music', 'Leave music out'),
  spokenCallToAction: yesNo('Say the call to action aloud', 'Leave the call to action unspoken'),
  priceOrOffer: yesNo('Mention the price or deal', 'Leave the price and deal unmentioned'),
  setting: { 'kitchen-table': 'Film at the kitchen table', bedroom: 'Film in a bedroom', outdoors: 'Film outdoors', studio: 'Film in a studio', other: 'Try another setting' },
  audienceFraming: { parents: 'Speak to parents', collectors: 'Speak to collectors', kids: 'Speak to kids', gift: 'Frame it as a gift' },
  cardTheme: { animals: 'Show animal cards', fantasy: 'Show fantasy cards', space: 'Show space cards', sport: 'Show sport cards', vehicles: 'Show vehicle cards', mixed: 'Mix card themes', other: 'Try another card theme', none: 'Leave the card theme out' },
  firstSeen: { product: 'Show the product first', person: 'Show the person first' },
  format: {
    'text-read': 'Make the text the focus', 'toy-catalogue-page': 'Make a toy catalogue page', 'news-article': 'Use a news article layout',
    'bulleted-list': 'Use a bulleted list', screenshot: 'Use a screenshot', 'ugc-photo': 'Use a customer-style photo',
    'offer-first-banner': 'Lead with the deal in a banner', 'founder-letter': 'Write a founder letter', 'unboxing-flat-lay': 'Lay out the unboxing',
    '3-reasons-listicle': 'Give three reasons', 'split-screen': 'Split the screen', 'text-on-object': 'Put the text on the object',
    '3-step-demo': 'Show a three-step demo', 'customer-card-montage': 'Make a montage of customer cards', 'social-thread': 'Use a social thread layout',
    'till-receipt': 'Use a till receipt layout', 'nutrition-label': 'Use a nutrition label layout', 'price-per-hour': 'Show the price per hour',
    'gift-guide': 'Make a gift guide', 'christmas-morning': 'Show Christmas morning', 'tier-list': 'Make a tier list',
    'venn-diagram': 'Use a Venn diagram', other: 'Try another format',
  },
  productInShot: yesNo('Show the product', 'Leave the product out of shot'),
  textDensity: { none: 'Leave the image free of text', 'one-line': 'Use one line of text', heavy: 'Fill it with useful text' },
  offerLine: yesNo('Add a deal line', 'Leave the deal line out'),
  priceShown: yesNo('Show the price', 'Leave the price out'),
  imageType: { photo: 'Use a photo', render: 'Use a render', generated: 'Use a generated image' },
  colourMood: { dark: 'Use dark colours', light: 'Use light colours', bright: 'Use bright colours' },
  stencilsShown: yesNo('Show the stencils', 'Leave stencils out of shot'),
};

export function creativeLiftLabel(attribute: AttributeDefinition, value: string): string {
  return liftPhrasing[attribute.key]?.[value]
    ?? `${attribute.label}: ${attribute.values.find(option => option.value === value)?.label ?? value}`;
}

export function mergeInstructions(instructions: readonly string[]): string {
  const unique = [...new Set(instructions)];
  if (unique.length > 1 && unique.every(text => text.startsWith('Say '))) {
    return `Say ${unique.map(text => text.slice(4)).sort().join(' and ')}`;
  }
  return unique.join('; ');
}
