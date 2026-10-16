import {neon} from '@neondatabase/serverless';
const tables=['boss_types','boss_kills','chat_settings','staging_admin_challenges','staging_line_events'];
// Only enabled temporarily during migration. The key is a Worker secret, not
// a URL parameter. Source snapshots never enter logs or cache.
export async function migrationGate(request,env,{sourceFactory=neon}={}) {
 if(env.MIGRATION_MODE!=='true')return null;
 const path=new URL(request.url).pathname;
 if(path==='/callback')return new Response('Database maintenance; retry later',{status:503});
 if(path!=='/__migration/snapshot')return null;
 const expected=env.MIGRATION_KEY;
 const actual=request.headers.get('authorization');
 if(!expected||actual!=='Bearer '+expected||request.method!=='POST')return new Response('Not Found',{status:404});
 if(!env.STAGING_DATABASE_URL)return new Response('Source unavailable',{status:503});
 try{
  const sql=sourceFactory(env.STAGING_DATABASE_URL);
  const expression=tables.map(t=>`'${t}',(SELECT coalesce(json_agg(x),'[]'::json) FROM ${t} x)`).join(',');
  const rows=await sql.query(`SELECT json_build_object(${expression}) AS snapshot`);
  return Response.json(rows[0].snapshot,{headers:{'cache-control':'no-store'}});
 }catch{return new Response('Snapshot failed',{status:500});}
}
