import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const columns={
 boss_types:['boss_key','boss_name','minutes'],
 boss_kills:['id','chat_id','boss_key','boss_name','kill_time','respawn_time'],
 chat_settings:['chat_id','half_mode'],
 staging_admin_challenges:['chat_id','command','expires_at'],
 staging_line_events:['event_id','reply','delivered_at','created_at']
};
const dates=new Set(['kill_time','respawn_time','expires_at','delivered_at','created_at']);
function literal(value) {
 if(value===null)return 'NULL';
 if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
 if(typeof value!=='string'||value.includes('\0'))throw Error('Unsupported migration value');
 return "'"+value.replaceAll("'","''")+"'";
}
export function convert(data) {
 const statements=[],manifest={};
 for(const [table,fields] of Object.entries(columns)) {
  if(!Array.isArray(data[table]))throw Error('Missing table: '+table);
  const normalized=data[table].map(row=>fields.map(field=>{
   let value=row[field];
   if(value===undefined)throw Error('Missing column: '+table+'.'+field);
   if(dates.has(field)&&value!==null){const date=new Date(value);if(!Number.isFinite(+date))throw Error('Invalid timestamp');value=date.toISOString();}
   if(field==='half_mode'){if(![true,false,0,1].includes(value))throw Error('Invalid half mode');value=Number(value);}
   if(field==='reply'&&value!==null)value=JSON.stringify(typeof value==='string'?JSON.parse(value):value);
   if(field==='id'&&typeof value==='string')value=Number(value);
   literal(value);
   return value;
  }));
  for(const row of normalized)statements.push(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${row.map(literal).join(',')});`);
  manifest[table]={rows:normalized.length,sha256:createHash('sha256').update(JSON.stringify(normalized.map(row=>JSON.stringify(row)).sort())).digest('hex')};
 }
 return {sql:statements.join('\n')+'\n',manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node convert-postgres-to-d1.mjs input.json output.sql');
 const result=convert(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,result.sql,{mode:0o600,flag:'wx'});
 writeFileSync(output+'.manifest.json',JSON.stringify(result.manifest,null,2),{mode:0o600,flag:'wx'});
 console.log('Migration files created. No database was changed.');
}
