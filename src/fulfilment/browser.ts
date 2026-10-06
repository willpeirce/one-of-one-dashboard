import { knownService } from './model.js';
import { rowsHtml, escape } from './view.js';
import type { previewImport } from './store.js';
type Preview = Awaited<ReturnType<typeof previewImport>> & {token:string;gbpPerUsd:number;week:{from:string;to:string}};
const file=document.querySelector<HTMLInputElement>('#export-file')!;
const area=document.querySelector<HTMLElement>('#upload-preview')!;
const status=document.querySelector<HTMLElement>('#upload-status')!;
const confirm=document.querySelector<HTMLButtonElement>('#confirm-upload')!;
const cancel=document.querySelector<HTMLButtonElement>('#cancel-upload')!;
const coverage=document.querySelector<HTMLElement>('#coverage-label')!;
const completeWeek=document.querySelector<HTMLInputElement>('#complete-week')!;
let token:string|null=null, generation=0;
function clear() {generation++;token=null;area.replaceChildren();confirm.hidden=cancel.hidden=true;status.textContent='';coverage.hidden=true;completeWeek.checked=false;}
file.addEventListener('change',()=>{clear();const current=generation,selected=file.files?.[0];if(!selected)return;
  if(selected.size>2_000_000){status.textContent='Choose a CSV smaller than 2 MB.';return;}
  status.textContent='Reading and matching…';
  void (async()=>{
    try {
      const response=await fetch('/api/fulfilment/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:await selected.text(),fileName:selected.name})});
      const result=await response.json() as Preview&{error?:string};
      if(current!==generation)return;
      if(!response.ok)throw new Error(result.error??'Could not preview this export.');
      token=result.token;coverage.hidden=false;document.querySelector('#coverage-copy')!.textContent=`This is the complete export for ${result.week.from}–${result.week.to}, including days with no despatches.`;
      area.innerHTML=`<h3>Review before saving</h3><p>Matched order numbers: ${escape(result.matched.join(', ')||'None')}<br>Unmatched order numbers: ${escape(result.unmatched.join(', ')||'None')}<br>${result.duplicates} duplicate rows will be skipped.<br>Unknown services: ${escape([...new Set(result.rows.filter(r=>!knownService(r.warehouse,r.service)).map(r=>r.service))].join(', ')||'None')}<br>Unknown centres: ${escape([...new Set(result.rows.filter(r=>r.warehouse==='unknown').map(r=>r.centre))].join(', ')||'None')}<br>Rate: £${result.gbpPerUsd} per USD.</p>${Object.entries(result.warehouses).map(([w,r])=>`<p>${w.toUpperCase()}: ${r.rows} rows · postage ${(r.postage/100).toFixed(2)} · pick &amp; pack ${(r.pickPack/100).toFixed(2)} ${w==='us'?'USD':w==='uk'?'GBP':'unknown currency'} · GBP total ${r.gbpPence===null?'unknown':'£'+(r.gbpPence/100).toFixed(2)} · customer paid £${(r.customerPaidPence/100).toFixed(2)}</p>`).join('')}${rowsHtml(result.rows)}`;
      status.textContent='Nothing saved. Check all rows, unknown services and centres, then confirm.';confirm.hidden=cancel.hidden=false;
    }catch(e){if(current===generation)status.textContent=e instanceof Error?e.message:'Could not preview this export.';}
  })();
});
cancel.addEventListener('click',()=>{clear();file.value='';status.textContent='Cancelled. Nothing saved.';});
confirm.addEventListener('click',()=>{
  if(!token)return;confirm.disabled=cancel.disabled=file.disabled=true;status.textContent='Saving confirmed parcels…';
  void(async()=>{try{const response=await fetch('/api/fulfilment/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,completeLastWeek:completeWeek.checked})});const result=await response.json() as {saved:number;skipped:number;error?:string};if(!response.ok)throw new Error(result.error??'Could not save. Preview again.');token=null;confirm.hidden=cancel.hidden=coverage.hidden=true;status.textContent=`Saved ${result.saved} parcels; skipped ${result.skipped} duplicates. Costs and rates are updated.`;
      // Refresh the saved figures while keeping the confirmation receipt visible.
      try { const updated = await fetch('/fulfilment');
      if (updated.ok) { const html = new DOMParser().parseFromString(await updated.text(), 'text/html'); for (const selector of ['.fulfilment-glance', '#fulfilment-review', '#model-detail']) { const next = html.querySelector(selector), current = document.querySelector(selector); if (next && current) current.innerHTML = next.innerHTML; } document.querySelector('#model-close')?.addEventListener('click', () => dialog.close()); } } catch { status.textContent += ' Refresh to view the updated figures.'; }
}catch(e){status.textContent=e instanceof Error?e.message:'Could not save.';}finally{confirm.disabled=cancel.disabled=file.disabled=false;}})();
});
const dialog=document.querySelector<HTMLDialogElement>('#model-detail')!;
document.querySelector('#model-open')!.addEventListener('click',()=>dialog.showModal());
document.querySelector('#model-close')!.addEventListener('click',()=>dialog.close());
