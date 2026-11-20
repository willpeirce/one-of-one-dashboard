// Every piece of text the Black Friday 2026 email countdown can draw, at the GIF's 2x pixel size.
// scripts/generate-countdown-glyphs.ts rasterises these into glyphs.generated.ts; change a word or
// size here, then re-run `npm run countdown:glyphs`.
export interface GlyphSpec {
  id: string;
  text: string;
  family: 'Anton' | 'Inter';
  weight: 400 | 700;
  size: number;
  letterSpacing: number;
}

const DIGIT_SIZE = 120;
const EYEBROW = { family: 'Inter', weight: 700, size: 28, letterSpacing: 6 } as const;
const LABEL = { family: 'Inter', weight: 700, size: 24, letterSpacing: 5 } as const;
const BIG = { family: 'Anton', weight: 400, size: DIGIT_SIZE, letterSpacing: 0 } as const;

export const GLYPH_SPECS = [
  ...(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const).map(d => ({ id: `digit-${d}` as const, text: d, ...BIG })),
  { id: 'colon', text: ':', ...BIG },
  { id: 'eyebrow-live', text: 'YOUR HEAD START ENDS IN', ...EYEBROW },
  { id: 'eyebrow-still', text: 'YOUR HEAD START ENDS', ...EYEBROW },
  { id: 'label-hrs', text: 'HRS', ...LABEL },
  { id: 'label-min', text: 'MIN', ...LABEL },
  { id: 'label-sec', text: 'SEC', ...LABEL },
  { id: 'still-uk', text: 'FRIDAY 6AM', ...BIG },
  { id: 'still-us', text: 'FRIDAY 1AM ET', ...BIG },
  { id: 'open', text: 'BLACK FRIDAY IS OPEN', ...BIG },
] as const satisfies readonly GlyphSpec[];

export type GlyphId = (typeof GLYPH_SPECS)[number]['id'];
