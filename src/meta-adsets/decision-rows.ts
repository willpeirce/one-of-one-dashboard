import type {AdSetsView,AdSetRow} from './presentation.js';
import type {VerdictWord} from './rules.js';
// Home presentation order differs from the spec's precedence when multiple rules fire.
const cardOrder:VerdictWord[]=['Kill','Slipping','Delivery','Test share','Step','Clear'];
export function decisionRows(view:AdSetsView,market='all'):AdSetRow[]{return view.rows.filter(r=>r.verdict&&r.verdict.verdict!=='Clear'&&(market==='all'||r.set.market===market)).sort((a,b)=>cardOrder.indexOf(a.verdict!.verdict)-cardOrder.indexOf(b.verdict!.verdict)||b.spend-a.spend||a.set.id.localeCompare(b.set.id));}
