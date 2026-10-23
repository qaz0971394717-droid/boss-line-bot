import {readFileSync} from 'node:fs';
import {GROUP_ACCESS_SCHEMA} from '../src/group-access.js';

const target=process.argv[2];
if(!['staging','production'].includes(target))throw Error('Invalid group approval target');
const config=target==='production'?'wrangler.production.toml':'wrangler.d1-staging.toml';
const id=readFileSync(config,'utf8').match(/database_id\s*=\s*"([a-f0-9-]+)"/)?.[1];
if(!id)throw Error('D1 binding missing');
const url=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}/query`;
async function query(sql){
 const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||!data.success||data.result.some(result=>!result.success))throw Error('Group approval schema preparation failed');
 return data.result;
}
for(const statement of GROUP_ACCESS_SCHEMA)await query(statement);
// Existing groups already have a settings row or BOSS records. Grandfather them
// once; later denials/revocations are preserved by INSERT OR IGNORE semantics.
await query(`INSERT OR IGNORE INTO group_access(chat_id,status,requested_at,approved_at,approved_by)
 SELECT chat_id,'approved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'grandfathered'
 FROM (SELECT chat_id FROM chat_settings UNION SELECT chat_id FROM boss_kills)`);
console.log(`Group approval schema ready for ${target}; existing chats grandfathered.`);
