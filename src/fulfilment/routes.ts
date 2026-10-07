import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import type { SourceMode } from '../sources.js';
import { readSettings } from '../settings.js';
import { ImportError, parseExport, type ParcelRow } from './parser.js';
import { confirmImport, fulfilmentSummary, previewImport, readEstimates, readUploads } from './store.js';
import { fulfilmentPage } from './view.js';

export async function seedFulfilment(db:Database,mode:SourceMode,now:Date) {
  if (mode!=='sample'||(await readUploads(db,mode)).length) return;
  const csv=await readFile(new URL('../../test/fixtures/fulfilment/sample.csv',import.meta.url),'utf8');
  const settings=await readSettings(db);
  const rows = parseExport(csv);
  await confirmImport(db,mode,rows.slice(0,20),'invented-baseline.csv',settings.values.jjGbpPerUsd,new Date(now.getTime()-60_000));
  await confirmImport(db,mode,rows,'invented-export.csv',settings.values.jjGbpPerUsd,now);
}
export function registerFulfilment(app:FastifyInstance,db:Database,auth:Auth,mode:SourceMode,clock:()=>Date,publish:()=>Promise<unknown>) {
  // Preview projections stay in memory for 15 minutes and belong to the signed-in device.
  // Raw CSV and unknown column cells are never persisted.
  const pending=new Map<string,{rows:ParcelRow[];fileName:string;rate:number;credential:string;expires:number}>();
  app.addHook('onClose',async()=>pending.clear());
  app.get('/fulfilment',async(request,reply)=>{
    if(!await auth.session(request))return reply.redirect('/login');
    const settings=await readSettings(db);
    return reply.type('text/html; charset=utf-8').send(fulfilmentPage(await fulfilmentSummary(db,mode,clock()),settings.values.jjGbpPerUsd));
  });
  app.get('/api/fulfilment',async(request,reply)=>{
    if(!await auth.session(request))return reply.code(401).send({error:'Sign in to continue.'});
    return {...await fulfilmentSummary(db,mode,clock()),estimates:await readEstimates(db,mode)};
  });
  app.post('/api/fulfilment/preview',{bodyLimit:2_500_000},async(request,reply)=>{
    const credential=await auth.session(request);
    if(!credential)return reply.code(401).send({error:'Sign in to continue.'});
    const body=request.body as {csv?:unknown;fileName?:unknown};
    if(!body||typeof body.csv!=='string'||typeof body.fileName!=='string'||!/^[-\w .()]{1,120}\.csv$/i.test(body.fileName))throw new ImportError('Choose an ExportOrders .csv file with a simple file name.');
    const rows=parseExport(body.csv), settings=await readSettings(db), token=randomUUID();
    for(const [key,value] of pending)if(value.expires<=Date.now()||value.credential===credential)pending.delete(key);
    if(pending.size>=10)throw new ImportError('Too many pending previews. Try again shortly.');
    pending.set(token,{rows,fileName:body.fileName,rate:settings.values.jjGbpPerUsd,credential,expires:Date.now()+15*60_000});
    return {...await previewImport(db,mode,rows,settings.values.jjGbpPerUsd),token,gbpPerUsd:settings.values.jjGbpPerUsd};
  });
  app.post('/api/fulfilment/confirm',async(request,reply)=>{
    const credential=await auth.session(request);
    if(!credential)return reply.code(401).send({error:'Sign in to continue.'});
    const token=(request.body as {token?:unknown})?.token;
    const preview=typeof token==='string'?pending.get(token):undefined;
    if(!preview||preview.credential!==credential||preview.expires<=Date.now())throw new ImportError('Preview the file again before confirming.');
    const result=await confirmImport(db,mode,preview.rows,preview.fileName,preview.rate,clock(),credential,(request.body as {completePeriod?:unknown}).completePeriod === true);
    pending.delete(token as string);await publish().catch(() => {});return result;
  });
}
