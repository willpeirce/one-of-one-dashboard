import type { ShopifyDashboard } from '../shopify/dashboard.js';
import type { AdSetsView, AdSetRow } from '../meta-adsets/presentation.js';
import type { CreativeCard } from '../creatives/presentation-types.js';
import { decisionRows } from '../meta-adsets/decision-rows.js';
import { actButton } from '../meta-adsets/view.js';
import { adSetName } from '../meta-adsets/name.js';
import { checksHtml } from '../shopify/presentation.js';
import { escapeCreative as e } from '../creatives/html.js';
import { formatNumber } from '../money.js';

export interface DecisionsState {
  shopify?: ShopifyDashboard;
  adSets?: AdSetsView;
  creatives?: CreativeCard[];
  market?: string;
  amberDials?: number;
}
type Need = ShopifyDashboard['needs'][number];
const sourceNames = { shopify: 'Shopify', 'j-and-j': 'J&J', meta: 'Meta', 'google-ads': 'Google Ads', tiktok: 'TikTok', pulse: 'Pulse' };
const source = (need: Need) => sourceNames[need.source];
function needLink(need: Need): string {
  const external = /^https?:\/\//.test(need.link);
  const shopify = /^https:\/\/(?:admin\.shopify\.com|[^/]+\.myshopify\.com)\//.test(need.link);
  const label = shopify ? 'Open in Shopify' : need.link.startsWith('/settings') ? 'Open settings'
    : need.link.startsWith('/ads') ? 'Open ads' : need.link.startsWith('/fulfilment') ? 'Open fulfilment' : 'Open source health';
  return `<a class="btn" href="${e(need.link)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
}
const figure = (value?: {value:string;label:string}, mark='') => value
  ? `<div class="act-figure"><strong>${e(value.value)}</strong><small>${e(value.label)}</small></div>`
  : `<div class="act-figure source-mark" aria-hidden="true">${e(mark)}</div>`;
const more = (body:string) => `<details class="act-more"><summary aria-label="More actions">⋯</summary><div class="act-menu">${body}</div></details>`;
function actCard(rank:number,state:'alarm'|'decide',source:string,verdict:string,title:string,reason:string,visual:string,primary:string,extra:string,attributes=''):string {
  return `<article class="dcard act-card" data-rank="${rank}" data-state="${state}" ${attributes}>${visual}<div class="act-copy"><div class="act-meta"><span class="chip ${state}">${state==='alarm'?'✕ Alarm':'◆ Decide'}</span><span>${e(source)}${verdict?` · ${e(verdict)}`:''}</span></div><h3 class="act-title" title="${e(title)}">${e(title)}</h3><p class="act-reason">${e(reason)}</p></div><div class="act-controls">${primary}${more(extra)}</div></article>`;
}
function needCard(need:Need):string {
  return actCard(0,'alarm',source(need),'',need.title,need.why,figure(need.figure,source(need)),needLink(need),`<p>${e(need.why)}</p>`,`data-source="${need.source}"`);
}
function adCard(row:AdSetRow,view:AdSetsView,rank:number):string {
  const verdict=row.verdict!;
  return actCard(rank,'decide','Meta',verdict.verdict,adSetName(row.set.name),verdict.reason,
    figure({value:verdict.figures[0]??'',label:verdict.figures[1]??''}),
    `<button class="btn" type="button" data-adset-open="${e(row.set.id)}">Open set</button>`,
    `<a class="btn" href="/ads">Open ads</a>${actButton(row,view)}`,
    `data-adset-verdict="${verdict.verdict}" data-mode="${view.mode}" data-market="${row.set.market}"`);
}
const copyButton=(card:CreativeCard)=>`<button class="btn" type="button" data-creative-copy="${e(card.brief??'')}">Copy brief</button>`;
const creativeActions=(card:CreativeCard,watch=false)=>`<button class="btn" type="button" data-creative-open="${e(card.groupId)}">Open creative</button><button class="btn" type="button" data-creative-action="done" data-card-id="${e(card.id)}">Done</button>${watch?`<button class="btn" type="button" data-creative-action="snooze" data-card-id="${e(card.id)}">Snooze 7 days</button>${copyButton(card)}`:''}`;
function creativeCard(card:CreativeCard):string {
  return actCard(3,'decide','Meta','Make next',card.title,card.reason,
    `<img class="act-thumbnail" src="${e(card.picture)}" width="48" height="64" alt="">`,copyButton(card),creativeActions(card),`data-card-id="${e(card.id)}" data-mode="${card.mode}"`);
}
function watchRow(text:string,actions:string,value?:{value:string;label:string},attrs=''):string {
  return `<details class="wrow" data-state="warn" ${attrs}><summary><span class="watch-glyph">△ Watch</span>${value?`<span class="watch-figure"><strong>${e(value.value)}</strong><small>${e(value.label)}</small></span>`:''}<span class="watch-text">${e(text)}</span><span class="watch-chevron" aria-hidden="true">⌄</span></summary><div class="watch-actions">${actions}</div></details>`;
}
function fold(items:string[],label:string,kind:string):string {
  return `${items.slice(0,3).join('')}${items.length>3?`<details class="decisions-fold ${kind}-fold"><summary>+${formatNumber(items.length-3)} ${label}</summary><div class="${kind}-rest">${items.slice(3).join('')}</div></details>`:''}`;
}
function stockHtml(model:ShopifyDashboard):string {
  const products=[...new Set(model.stock.map(row=>row.product))];
  const status=(row:ShopifyDashboard['stock'][number])=> {
    const stock=row.cover===null?'info':row.cover<21?'alarm':row.cover<60?'warn':'good';
    const attach=row.required!==null&&row.available!==null&&row.available<row.required?'warn':row.required!==null&&row.available!==null?'good':'info';
    return stock==='alarm'?'alarm':stock==='warn'||attach==='warn'?'warn':stock==='good'||attach==='good'?'good':'info';
  };
  const productRows=products.map(product=>({product,rows:model.stock.filter(row=>row.product===product)}));
  const fine=productRows.filter(p=>p.rows.length>=2&&p.rows.every(r=>status(r)==='good'));
  const cell=(product:string,market:string)=>{
    const row=model.stock.find(r=>r.product===product&&r.market===market);
    if(!row)return `<div class="stock-cell" data-stock-product="${e(product)}" data-stock-market="${market}">i Unknown</div>`;
    const state=status(row),attach=row.required!==null;
    const ratio=attach?row.required!>0?(row.available??0)/row.required!:1:(row.cover??0)/90;
    const text=attach?`${row.available===null?'?':formatNumber(row.available)} / ${formatNumber(Math.ceil(row.required!))}`:row.cover===null?'Unknown':`${formatNumber(Math.floor(row.cover))} days`;
    return `<div class="stock-cell" aria-label="${e(`${state==='alarm'?'✕ Alarm':state==='warn'?'△ Watch':state==='good'?'✓ Good':'i Info'} · ${product} · ${market.toUpperCase()} · ${text}`)}" data-stock-product="${e(product)}" data-stock-market="${market}"${state==='alarm'||state==='warn'?` data-state="${state}"`:''}><span>${state==='alarm'?'✕':state==='warn'?'△':state==='good'?'✓':'i'} ${e(text)}</span><span class="stock-bar" aria-hidden="true"><i style="width:${Math.max(0,Math.min(1,ratio))*100}%"></i></span></div>`;
  };
  const rows=(items:typeof productRows)=>items.map(({product})=>`<div class="stock-product">${e(product)}</div>${cell(product,'uk')}${cell(product,'us')}`).join('');
  const regular=productRows.filter(p=>!fine.includes(p));
  return `<div class="stock-heading"><h3>Days left</h3><button class="btn tab" type="button" data-tab="stock">Stock dials</button></div><div class="stock-grid"><span></span><strong>UK</strong><strong>US</strong>${rows(regular)}</div>${fine.length?`<details class="stock-fine"><summary>+${formatNumber(fine.length)} fine</summary><div class="stock-grid">${rows(fine)}</div></details>`:''}`;
}
export function decisionsHtml(state:DecisionsState):string {
  const needs=(state.shopify?.needs??[]).filter(n=>!n.id.startsWith('stock:')&&!n.id.startsWith('attach:'));
  const adSets=state.adSets&&(!state.shopify||state.adSets.mode==='live')?state.adSets:undefined;
  const ads=adSets?decisionRows(adSets,state.market??'all'):[];
  const creatives=(state.creatives??[]).filter(c=>!state.shopify||c.mode==='live');
  const ranked:{rank:number;html:string}[]=needs.filter(n=>n.state==='alarm').map(n=>({rank:0,html:needCard(n)}));
  for(const row of ads){const rank=({Kill:1,Slipping:2,Step:4} as Record<string,number>)[row.verdict!.verdict];if(rank!==undefined)ranked.push({rank,html:adCard(row,adSets!,rank)});}
  ranked.push(...creatives.filter(c=>c.kind==='decide').map(c=>({rank:3,html:creativeCard(c)})));
  ranked.sort((a,b)=>a.rank-b.rank);
  const watch=needs.filter(n=>n.state==='warn').map(n=>watchRow(`${source(n)} · ${n.title} · ${n.why}`,needLink(n),n.figure,`data-source="${n.source}"`));
  for(const row of ads.filter(r=>['Delivery','Test share'].includes(r.verdict!.verdict)))watch.push(watchRow(`Meta · ${row.verdict!.verdict} · ${adSetName(row.set.name)} · ${row.verdict!.reason}`,`<button class="btn" type="button" data-adset-open="${e(row.set.id)}">Open set</button><a class="btn" href="/ads">Open ads</a>${actButton(row,adSets!)}`,{value:row.verdict!.figures[0]??'',label:row.verdict!.figures[1]??''},`data-adset-verdict="${row.verdict!.verdict}"`));
  watch.push(...creatives.filter(c=>c.kind==='watch').map(c=>watchRow(`Meta · ${c.title} · ${c.reason}`,creativeActions(c,true),undefined,`data-card-id="${e(c.id)}" data-mode="${c.mode}"`)));
  return `<section id="act" aria-label="Act"><div class="act-list">${ranked.length?fold(ranked.map(r=>r.html),'more decisions','act'):'<p class="nothing-decide">✓ Nothing to decide</p>'}</div></section><section id="stock" aria-label="Stock">${state.shopify?stockHtml(state.shopify):''}</section><section id="watch" aria-label="To watch">${watch.length?`<h3>To watch</h3>${fold(watch,'more','watch')}`:''}${state.amberDials?`<a class="amber-dials" href="#dials">${formatNumber(state.amberDials)} dials in amber</a>`:''}</section><section id="checks">${state.shopify?checksHtml(state.shopify):''}</section>`;
}
