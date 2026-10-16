import type { LiftConfidence } from './lifts.js';

export function strengthMeter(confidence: LiftConfidence): string {
  const lit = { Hint: 1, Likely: 2, Strong: 3 }[confidence], label = `Strength: ${confidence.toLowerCase()}`;
  return `<span class="strength-meter" data-strength="${confidence.toLowerCase()}" role="img" aria-label="${label}" title="${label}">${[1, 2, 3].map(bar => `<i aria-hidden="true"${bar <= lit ? ' class="lit"' : ''}></i>`).join('')}</span>`;
}
