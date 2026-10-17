import {OVERWRITE_SCHEMA} from '../src/overwrite-guard.js';
import {UNDO_SCHEMA} from '../src/undo.js';
import {readFileSync} from 'node:fs';
const target=process.argv[2]||'staging';
if(!['staging','production'].includes(target))throw Error('Invalid undo target');
const id=readFileSync(target==='production'?'wrangler.production.toml':'wrangler.d1-staging.toml','utf8').match(/database_id\s*=\s*"([a-f0-9-]+)"/)[1];
const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql:UNDO_SCHEMA.join(';')+';'+OVERWRITE_SCHEMA+';'}),signal:AbortSignal.timeout(30000)});
const d=await r.json();if(!r.ok||!d.success||d.result.some(x=>!x.success))throw Error('Undo schema setup failed');
console.log(target+' undo tables and revision triggers ready.');
