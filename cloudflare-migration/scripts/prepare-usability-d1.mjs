import {readFileSync} from 'node:fs';
const target=process.argv[2];if(!['staging','production'].includes(target))throw Error('Invalid target');
const config=target==='production'?'wrangler.production.toml':'wrangler.d1-staging.toml';
const id=readFileSync(config,'utf8').match(/database_id\s*=\s*"([a-f0-9-]+)"/)?.[1];if(!id)throw Error('Binding missing');
const url=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${id}/query`;
async function query(sql){const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql})});const data=await response.json();if(!response.ok||!data.success||!data.result[0]?.success)throw Error('Schema preparation failed');return data.result[0].results;}
const columns=await query('PRAGMA table_info(boss_kills)');
if(!columns.some(c=>c.name==='last_event_ms'))await query('ALTER TABLE boss_kills ADD COLUMN last_event_ms INTEGER NOT NULL DEFAULT 0');
await query('CREATE TABLE IF NOT EXISTS command_confirmations (chat_id TEXT NOT NULL,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(chat_id,user_id))');
console.log('Usability schema ready for '+target+'; existing boss data preserved.');
