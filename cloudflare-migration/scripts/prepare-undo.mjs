import {UNDO_SCHEMA} from '../src/undo.js';
import {readFileSync} from 'node:fs';
const id=readFileSync('wrangler.d1-staging.toml','utf8').match(/database_id\s*=\s*"([a-f0-9-]+)"/)[1];
const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql:UNDO_SCHEMA.join(';')+';'}),signal:AbortSignal.timeout(30000)});
const d=await r.json();if(!r.ok||!d.success||d.result.some(x=>!x.success))throw Error('Undo staging schema setup failed');
console.log('Staging undo tables and revision triggers ready.');
