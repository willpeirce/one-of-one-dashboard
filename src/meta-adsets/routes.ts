import {MetaActionsClient} from './actions-client.js';
import {actOnAdSet,AdActionError} from './actions.js';
import {MetaSpend} from '../ad-spend/clients.js';
import {creativeFeatureFlags} from '../creatives/config.js';
import type {AdTransportOptions} from '../ad-spend/http.js';
import type {FastifyInstance} from 'fastify';
import type {Database} from '../db.js';
import type {Auth} from '../auth.js';
import {readSettings} from '../settings.js';
import {readAdSetsView} from './presentation.js';
import {adsPage} from './view.js';
export function registerAdSets(app:FastifyInstance,db:Database,auth:Auth,env:NodeJS.ProcessEnv,clock:()=>Date,options:AdTransportOptions={},publish:()=>Promise<void>=async()=>{}):void {
 const enabled=creativeFeatureFlags(env).metaActionsEnabled;
 const client=enabled?new MetaActionsClient(options.fetch):null;
 const reader=enabled?new MetaSpend(process.env.META_ACCESS_TOKEN??'',options):null;
 app.post('/api/meta/adset/:id',{bodyLimit:1024},async(request,reply)=>{
  if(!client||!reader)return reply.code(404).send({error:'Not found.'});
  const who=await auth.session(request);if(!who)return reply.code(401).send({error:'Sign in to continue.'});
  const {id}=request.params as {id:string};
  try {
    const result=await actOnAdSet(db,id,request.body,who,clock(),client,reader);
    await publish().catch(()=>console.info('Meta action saved; dashboard refresh pending.'));return result;
  } catch(error) {
    if(error instanceof AdActionError)return reply.code(error.statusCode).send({error:error.statusCode===502?'Meta action failed.':'Ad-set action refused.'});
    throw error;
  }
 });
 app.get('/ads',async(request,reply)=>{if(!await auth.session(request))return reply.redirect('/login');return reply.type('text/html; charset=utf-8').send(adsPage(await readAdSetsView(db,(await readSettings(db)).values,env,clock())));});
 app.get('/api/meta/adsets',async(request,reply)=>{if(!await auth.session(request))return reply.code(401).send({error:'Sign in to continue.'});return readAdSetsView(db,(await readSettings(db)).values,env,clock());});
}
