const base='https://hongzhe-personal-memo.qaz0971394717.workers.dev',endpoint=base+'/callback';
const token=process.env.MEMO_LINE_CHANNEL_ACCESS_TOKEN;
async function line(path,method='GET',body){const r=await fetch('https://api.line.me/v2/bot/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Memo LINE setup failed: '+r.status);return r.json();}
const old=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
if(old.ok){const state=await old.json();if(state.endpoint&&state.endpoint!==endpoint)throw Error('Refusing to replace a different bot webhook');}else if(old.status!==404)throw Error('LINE authorization failed');
await line('channel/webhook/endpoint','PUT',{endpoint});
const checked=await line('channel/webhook/test','POST',{endpoint});if(!checked.success)throw Error('LINE signature/webhook test failed');
const info=await line('channel/webhook/endpoint');
const health=await (await fetch(base,{signal:AbortSignal.timeout(15000)})).json();
console.log('PASS: LINE webhook endpoint and signed callback verification.');
console.log('Owner configured: '+Boolean(health.owner_configured));
console.log('Use webhook enabled: '+Boolean(info.active));
console.log('Webhook URL: '+endpoint);
