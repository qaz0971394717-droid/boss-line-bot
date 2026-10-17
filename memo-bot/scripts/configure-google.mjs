import {execFileSync} from 'node:child_process';
const client=process.env.MEMO_GOOGLE_CLIENT_ID,secret=process.env.MEMO_GOOGLE_CLIENT_SECRET;
if(!client||!secret){console.log('Google OAuth setup pending; existing memo and manual calendar links remain available.');process.exit(0);}
const url=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/hongzhe-personal-memo/secrets`;
const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'manual',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||!data.success)throw Error('Cannot inspect memo secret names');
const put=(key,value)=>execFileSync('./node_modules/.bin/wrangler',['secret','put',key],{input:value,stdio:['pipe','pipe','pipe']});
if(!data.result.some(s=>s.name==='GOOGLE_TOKEN_KEY')){const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');put('GOOGLE_TOKEN_KEY',key);}
put('GOOGLE_CLIENT_ID',client);put('GOOGLE_CLIENT_SECRET',secret);
console.log('Google OAuth configuration installed. Encryption key stays only in Worker secrets.');
