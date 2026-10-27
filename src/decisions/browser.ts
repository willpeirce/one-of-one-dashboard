import { decisionsHtml, type DecisionsState } from './view.js';
let state: DecisionsState = {};
/** Every Home source refresh replaces the same Decisions body from its own state slice. */
export function setDecisions(part: Partial<DecisionsState>): void {
  const deck=document.querySelector<HTMLElement>('#deck');
  if(!deck)return;
  state={...state,...part};
  deck.innerHTML=decisionsHtml(state);
  document.dispatchEvent(new Event('pulse:decisions-rendered'));
}
