import {adSetName} from './name.js';
import {adSetCards,adSetSummary,adSetTable,adSetSheet,actionForm} from './view.js';
import type {AdSetsView} from './presentation.js';
let acting=false;
let view:AdSetsView|undefined,market='all',opened:string|undefined;
function show(id:string){const row=view?.rows.find(r=>r.set.id===id),dialog=document.querySelector<HTMLDialogElement>('#adset-sheet');if(!view||!row||!dialog)return;opened=id;document.querySelector('#adset-sheet-content')!.innerHTML=adSetSheet(row,view);if(!dialog.open)dialog.showModal();}
export function updateAdSets(next:AdSetsView,selectedMarket=market):void {
 view=next;market=selectedMarket;
 const cards=document.querySelector('#adset-cards'),summary=document.querySelector('#adset-summary'),table=document.querySelector('#adsets-table');
 if(cards)cards.innerHTML=adSetCards(view,market);
 if(summary)summary.innerHTML=adSetSummary(view,market);
 if(table)table.innerHTML=adSetTable(view,market);
 if(!acting&&opened&&document.querySelector<HTMLDialogElement>('#adset-sheet')?.open)show(opened);
}
document.addEventListener('click',event=>{
 const target=event.target;if(!(target instanceof Element))return;
 if(target.closest('[data-adset-close]')){document.querySelector<HTMLDialogElement>('#adset-sheet')?.close();opened=undefined;acting=false;return;}
 const select=target.closest<HTMLElement>('[data-adset-market]');if(select&&view){document.querySelectorAll<HTMLElement>('[data-adset-market]').forEach(b=>b.setAttribute('aria-selected',String(b===select)));updateAdSets(view,select.dataset.adsetMarket);return;}
 const preset=target.closest<HTMLElement>('[data-budget-value]');if(preset){const form=preset.closest('form')!;form.querySelector<HTMLInputElement>('[name=value]')!.value=preset.dataset.budgetValue!;form.querySelector<HTMLSelectElement>('[name=action]')!.value='budget';return;}
 const act=target.closest<HTMLElement>('[data-adset-act]');if(act&&view?.actionsEnabled){const row=view.rows.find(r=>r.set.id===act.dataset.adsetAct);if(row){acting=true;document.querySelector('#adset-sheet-content')!.innerHTML=actionForm(row);const dialog=document.querySelector<HTMLDialogElement>('#adset-sheet')!;if(!dialog.open)dialog.showModal();}return;}
 const undo=target.closest<HTMLElement>('[data-adset-undo]');if(undo&&view?.actionsEnabled){confirmAction(undo.dataset.adsetId!,{action:'undo',value:undo.dataset.adsetUndo},'Undo the saved action');return;}
 const open=target.closest<HTMLElement>('[data-adset-open]');if(open){show(open.dataset.adsetOpen!);return;}
 const row=target.closest<HTMLElement>('[data-adset-row]');if(row&&!target.closest('a,button'))show(row.dataset.adsetRow!);
});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target instanceof HTMLElement&&event.target.matches('[data-adset-row]')){event.preventDefault();show(event.target.dataset.adsetRow!);}});
const initial=document.querySelector('#adsets-data');
if(initial?.textContent){updateAdSets(JSON.parse(initial.textContent));const refresh=async()=>{try{const response=await fetch('/api/meta/adsets',{credentials:'same-origin'});if(response.ok)updateAdSets(await response.json());}catch{}};setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30_000);}

function confirmAction(id:string,body:{action:string;value?:unknown},summary:string):void {
 acting=true;const container=document.querySelector<HTMLElement>('#adset-sheet-content')!;container.replaceChildren();
 const heading=document.createElement('h2');heading.textContent='Confirm action';container.append(heading);
 const text=document.createElement('p');text.textContent=summary;container.append(text);
 const confirm=document.createElement('button');confirm.className='btn';confirm.textContent='Confirm';container.append(confirm);
 const dialog=document.querySelector<HTMLDialogElement>('#adset-sheet')!;if(!dialog.open)dialog.showModal();
 confirm.onclick=async()=>{confirm.disabled=true;
  try{const response=await fetch(`/api/meta/adset/${encodeURIComponent(id)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!response.ok){text.textContent=response.status===409?'This set changed or Undo expired. Close and refresh.':'Action refused or Meta unavailable. Close and refresh before trying again.';return;}
   const result=await response.json() as {id:string;refreshed:boolean};text.textContent=result.refreshed?'Saved. Catalogue refreshed.':'Saved. Catalogue refresh pending.';
   const refreshed=await fetch('/api/meta/adsets',{credentials:'same-origin'});if(refreshed.ok)updateAdSets(await refreshed.json());
   if(body.action!=='undo'){const undo=document.createElement('button');undo.className='btn';undo.textContent='Undo';undo.dataset.adsetUndo=result.id;undo.dataset.adsetId=id;container.append(undo);}
  }catch{text.textContent='Connection interrupted. Check the Actions list before trying again.';}
 };
}
document.addEventListener('submit',event=>{const form=event.target;if(!(form instanceof HTMLFormElement)||form.id!=='adset-action-form'||!view)return;event.preventDefault();const row=view.rows.find(r=>r.set.id===form.dataset.adsetId)!;
 const action=form.querySelector<HTMLSelectElement>('[name=action]')!.value,value=action==='budget'?form.querySelector<HTMLInputElement>('[name=value]')!.valueAsNumber:action==='pause'?'PAUSED':'ACTIVE';
 confirmAction(row.set.id,{action,value},`${adSetName(row.set.name)} · ${action} · current ${action==='budget'?`£${row.set.dailyBudget!/100}`:row.set.status} → ${action==='budget'?`£${value}`:value} · ${row.verdict?.verdict==='Clear'?'no rule met, your call':row.verdict?.reason}`);
});

document.addEventListener('submit',async event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement)||form.id!=='adset-flags-form')return;
 event.preventDefault();acting=true;const button=form.querySelector<HTMLButtonElement>('button')!,status=form.querySelector<HTMLElement>('[role=status]')!;button.disabled=true;
 try {
  const response=await fetch(`/api/meta/adset/${encodeURIComponent(form.dataset.adsetId!)}/flags`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({flatBudget:form.querySelector<HTMLInputElement>('[name=flatBudget]')!.checked})});
  if(!response.ok){status.textContent='Budget flag could not be saved.';return;}
  status.textContent='Saved.';
  const refreshed=await fetch('/api/meta/adsets',{credentials:'same-origin'});if(refreshed.ok)updateAdSets(await refreshed.json());
 }catch{status.textContent='Connection interrupted. Refresh to check the flag.';}
 finally{acting=false;button.disabled=false;}
});
