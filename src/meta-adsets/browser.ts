import {adSetCards,adSetSummary,adSetTable,adSetSheet} from './view.js';
import type {AdSetsView} from './presentation.js';
let view:AdSetsView|undefined,market='all',opened:string|undefined;
function show(id:string){const row=view?.rows.find(r=>r.set.id===id),dialog=document.querySelector<HTMLDialogElement>('#adset-sheet');if(!view||!row||!dialog)return;opened=id;document.querySelector('#adset-sheet-content')!.innerHTML=adSetSheet(row,view);if(!dialog.open)dialog.showModal();}
export function updateAdSets(next:AdSetsView,selectedMarket=market):void {
 view=next;market=selectedMarket;
 const cards=document.querySelector('#adset-cards'),summary=document.querySelector('#adset-summary'),table=document.querySelector('#adsets-table');
 if(cards)cards.innerHTML=adSetCards(view,market);
 if(summary)summary.innerHTML=adSetSummary(view,market);
 if(table)table.innerHTML=adSetTable(view,market);
 if(opened&&document.querySelector<HTMLDialogElement>('#adset-sheet')?.open)show(opened);
}
document.addEventListener('click',event=>{
 const target=event.target;if(!(target instanceof Element))return;
 if(target.closest('[data-adset-close]')){document.querySelector<HTMLDialogElement>('#adset-sheet')?.close();opened=undefined;return;}
 const select=target.closest<HTMLElement>('[data-adset-market]');if(select&&view){document.querySelectorAll<HTMLElement>('[data-adset-market]').forEach(b=>b.setAttribute('aria-selected',String(b===select)));updateAdSets(view,select.dataset.adsetMarket);return;}
 const open=target.closest<HTMLElement>('[data-adset-open]');if(open){show(open.dataset.adsetOpen!);return;}
 const row=target.closest<HTMLElement>('[data-adset-row]');if(row&&!target.closest('a,button'))show(row.dataset.adsetRow!);
});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target instanceof HTMLElement&&event.target.matches('[data-adset-row]')){event.preventDefault();show(event.target.dataset.adsetRow!);}});
const initial=document.querySelector('#adsets-data');
if(initial?.textContent){updateAdSets(JSON.parse(initial.textContent));const refresh=async()=>{try{const response=await fetch('/api/meta/adsets',{credentials:'same-origin'});if(response.ok)updateAdSets(await response.json());}catch{}};setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30_000);}
