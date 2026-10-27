import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionsHtml } from '../src/decisions/view.js';
import { defaultSettings } from '../src/settings.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import type { ShopifyDashboard } from '../src/shopify/dashboard.js';
import type { CreativeCard } from '../src/creatives/presentation-types.js';

const shopify = (): ShopifyDashboard => ({mode:'live',stock:[],checks:[],needs:[],detail:{},live:{lastOrder:'Invented',dispatch:'Invented',carts:'Invented'}});
const creative: CreativeCard = {id:'invented-card',kind:'decide',groupId:'invented-group',picture:'/invented.png',title:'Invented next creative',reason:'Invented evidence',brief:'Invented brief',mode:'live'};

test('one Decisions renderer ranks acts, folds after three and puts Delivery and Test share in Watch',()=>{
 const model=shopify();model.needs=[{id:'invented-alarm',source:'pulse',state:'alarm',title:'Invented alarm',why:'Invented failure',link:'/sources',figure:{value:'3',label:'invented checks'}}];
 const adSets={...sampleAdSetsView(defaultSettings()),mode:'live' as const};
 const html=decisionsHtml({shopify:model,adSets,creatives:[creative]});
 assert.deepEqual([...html.matchAll(/data-rank="(\d)"/g)].map(m=>Number(m[1])),[0,1,2,3,4]);
 assert.match(html,/\+2 more decisions/);
 assert.equal((html.match(/class="dcard act-card"/g)??[]).length,5);
 assert.equal((html.match(/class="wrow"/g)??[]).length,2);
 assert.match(html,/<details class="wrow" data-state="warn" data-adset-verdict="Delivery"/);
 assert.match(html,/<details class="wrow" data-state="warn" data-adset-verdict="Test share"/);
 for(const word of ['Kill','Slipping','Step'])assert.match(html,new RegExp(`data-state="decide"[^>]*data-adset-verdict="${word}"`));
 assert.match(html,/✕ Alarm/);assert.doesNotMatch(html,/data-act=|data-copy=|data-confirm=|data-undo=/);
});

test('Shopify snapshot excludes sample ad and creative decisions, while absent snapshot retains them',()=>{
 const adSets=sampleAdSetsView(defaultSettings()),creatives=[{...creative,mode:'sample' as const}];
 const hidden=decisionsHtml({shopify:shopify(),adSets,creatives});
 assert.match(hidden,/Nothing to decide/);assert.doesNotMatch(hidden,/data-adset-verdict|invented-card/);
 const shown=decisionsHtml({adSets,creatives});assert.match(shown,/data-adset-verdict/);assert.match(shown,/invented-card/);
});

test('need source and destination determine escaped words and link behavior without inferred stock text',()=>{
 const model=shopify();model.needs=[
  {id:'invented-meta',source:'meta',state:'warn',title:'Invented <risk>',why:'Invented <evidence>',link:'/ads',figure:{value:'£27.40',label:'an order · 3 days'}},
  {id:'invented-shopify',source:'shopify',state:'alarm',title:'Invented order check',why:'Invented reason',link:'https://admin.shopify.com/store/invented'},
  {id:'stock:invented',source:'shopify',state:'alarm',title:'Must not become a card',why:'Unparsed stock text',link:'/sources'},
 ];
 const html=decisionsHtml({shopify:model});
 assert.match(html,/Meta · Invented &lt;risk&gt;/);assert.match(html,/href="\/ads">Open ads/);
 assert.match(html,/href="https:\/\/admin.shopify.com\/store\/invented" target="_blank" rel="noopener noreferrer">Open in Shopify/);
 assert.doesNotMatch(html,/Must not become a card|Unparsed stock text|href="\/ads" target=/);
});

test('stock uses product/market metadata, folds fine products and retains all alert cells for counts',()=>{
 const model=shopify();
 model.stock=['Invented low','Invented fine'].flatMap((product,index)=>(['uk','us'] as const).map(market=>({product,market,productId:product,locationId:market,name:'Never parse this',available:100,required:null,dailyRate:1,cover:index?90:market==='uk'?10:40,runOut:null,basis:'Invented basis'})));
 const html=decisionsHtml({shopify:model});
 assert.match(html,/\+1 fine/);assert.equal((html.match(/data-stock-product=/g)??[]).length,4);
 assert.equal((html.match(/data-state="alarm"/g)??[]).length,1);assert.equal((html.match(/data-state="warn"/g)??[]).length,1);
 assert.match(html,/data-stock-market="uk" data-state="alarm"/);assert.doesNotMatch(html,/Never parse this/);
 assert.match(html,/✓ 0 of 0 checks passing/);
});
