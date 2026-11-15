import type {FastifyInstance} from 'fastify';
import type {Auth} from '../auth.js';
import type {Database} from '../db.js';
import {appConfig} from '../config.js';
import type {SourceMode} from '../sources.js';
import type {Check} from '../shopify/watchdogs.js';
import {isAlertCheckId} from './alert-types.js';

export function alertDestination(link:unknown):string {
  if(link==='/sources'||link==='/morning')return link;
  if(typeof link!=='string')return '/sources';
  try {
    const target=new URL(link),store=appConfig.shopify.storeDomain.split('.')[0];
    return target.origin==='https://admin.shopify.com'&&!target.username&&!target.password
      &&(target.pathname===`/store/${store}`||target.pathname.startsWith(`/store/${store}/`))?target.href:'/sources';
  } catch {return '/sources';}
}
/** Push paths stay local; an authenticated tap follows the check's existing source link. */
export function registerAlertLinks(app:FastifyInstance,db:Database,auth:Auth,mode:SourceMode):void {
  app.get<{Params:{id:string}}>('/alerts/check/:id',async(request,reply)=>{
    if(!await auth.session(request))return reply.redirect('/login');
    reply.header('Cache-Control','no-store');
    if(!isAlertCheckId(request.params.id))return reply.code(404).send({error:'Check not found.'});
    const row=(await db.query<{data:{checks?:Check[]}}>('SELECT data FROM pulse.shopify_watchdog_state WHERE mode=$1',[mode])).rows[0];
    const check=Array.isArray(row?.data?.checks)?row.data.checks.find(check=>check.id===request.params.id):undefined;
    return reply.redirect(alertDestination(check?.link));
  });
}
