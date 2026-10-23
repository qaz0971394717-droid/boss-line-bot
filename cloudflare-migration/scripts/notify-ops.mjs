import {createHash} from 'node:crypto';
export async function notifyOps({target,kind,message,incident}){
 if(!process.env.OPS_ALERT_KEY)throw Error('LINE alert authorization unavailable');
 const h=createHash('sha256').update(`${target}:${incident}:${kind}`).digest('hex');
 const retryKey=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
 const r=await fetch('https://hit2-boss-staging.qaz0971394717.workers.dev/ops/notify',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPS_ALERT_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({target,kind,message,retryKey}),signal:AbortSignal.timeout(20000)});
 if(r.status===409){console.log('::warning::LINE notification destination not bound yet.');return false;}
 if(!r.ok)throw Error('LINE operational notification failed');
 return true;
}
