import type {FastifyInstance} from 'fastify';
import type {Database} from '../db.js';
import type {Auth} from '../auth.js';
import {readSettings} from '../settings.js';
import {readAdSetsView} from './presentation.js';
import {adsPage} from './view.js';
export function registerAdSets(app:FastifyInstance,db:Database,auth:Auth,env:NodeJS.ProcessEnv,clock:()=>Date):void {
 app.get('/ads',async(request,reply)=>{if(!await auth.session(request))return reply.redirect('/login');return reply.type('text/html; charset=utf-8').send(adsPage(await readAdSetsView(db,(await readSettings(db)).values,env,clock())));});
 app.get('/api/meta/adsets',async(request,reply)=>{if(!await auth.session(request))return reply.code(401).send({error:'Sign in to continue.'});return readAdSetsView(db,(await readSettings(db)).values,env,clock());});
}
