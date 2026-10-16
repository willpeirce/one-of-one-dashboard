import type {AdSetsView,AdSetRow} from './presentation.js';
import {verdictOrder} from './rules.js';
export function decisionRows(view:AdSetsView,market='all'):AdSetRow[]{return view.rows.filter(r=>r.verdict&&r.verdict.verdict!=='Clear'&&(market==='all'||r.set.market===market)).sort((a,b)=>verdictOrder.indexOf(a.verdict!.verdict)-verdictOrder.indexOf(b.verdict!.verdict)||b.spend-a.spend||a.set.id.localeCompare(b.set.id));}
