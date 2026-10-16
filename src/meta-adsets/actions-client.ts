import {AdError} from '../ad-spend/model.js';
/** This is the sole Meta write boundary. The read client exposes no write operation. */
export class MetaActionsClient {
 #token:string;
 #fetch:typeof fetch;
 constructor(fetcher:typeof fetch=fetch){this.#token=process.env.META_ACCESS_TOKEN??'';this.#fetch=fetcher;}
 async #send(id:string,field:'status'|'daily_budget',value:string):Promise<void>{
  if(!/^\d{1,24}$/.test(id)||!this.#token)throw new AdError('unauthorized');
  let response:Response;
  try{response=await this.#fetch(`https://graph.facebook.com/v25.0/${id}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{Authorization:`Bearer ${this.#token}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({[field]:value}).toString()});}
  catch{console.error('Meta action failed (timeout).');throw new AdError('timeout');}
  let body:any;try{body=await response.json();}catch{body=null;}
  const error=new AdError('http',response.status,body?.error?.code,body?.error?.error_subcode);
  console.info(`Meta action http ${response.status}${error.providerCode===undefined?'':`, meta ${error.providerCode}${error.providerSubcode===undefined?'':`/${error.providerSubcode}`}`}.`);
  if(!response.ok||body?.error||body?.success!==true)throw error;
 }
 pause(id:string):Promise<void>{return this.#send(id,'status','PAUSED');}
 resume(id:string):Promise<void>{return this.#send(id,'status','ACTIVE');}
 setDailyBudget(id:string,minor:number):Promise<void>{if(!Number.isSafeInteger(minor)||minor<100)throw new AdError('invalid');return this.#send(id,'daily_budget',String(minor));}
}
