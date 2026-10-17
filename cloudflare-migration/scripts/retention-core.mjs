import {EVENT_RETENTION_DAYS,REPLY_RETENTION_HOURS} from '../src/retention-policy.js';
export function validateReceipt(receipt,{databaseId,prefix,now=Date.now()}){
 if(!receipt||receipt.databaseId!==databaseId||receipt.verified!==true||!receipt.key?.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(receipt.sha256||''))throw Error('Verified backup receipt missing or mismatched');
 const age=now-Date.parse(receipt.verifiedAt);
 if(!Number.isFinite(age)||age< -300000||age>3600000)throw Error('Backup receipt is stale');
}
export const INDEX_SQL=[
 'CREATE INDEX IF NOT EXISTS line_events_delivered_retention ON staging_line_events(delivered_at) WHERE delivered_at IS NOT NULL',
 'CREATE INDEX IF NOT EXISTS line_events_reply_retention ON staging_line_events(delivered_at) WHERE delivered_at IS NOT NULL AND reply IS NOT NULL'
];
export async function cleanEvents(query,{now=Date.now(),writeBudget=30000,batchSize=250}={}){
 const cutoff=new Date(now-EVENT_RETENTION_DAYS*86400000).toISOString();
 const replyCutoff=new Date(now-REPLY_RETENTION_HOURS*3600000).toISOString();
 const result={deleted:0,compacted:0,writes:0,budgetExhausted:false};
 // Delete old delivered records first. Never modify a pending/failed event.
 const operations=[['deleted',`DELETE FROM staging_line_events WHERE delivered_at IS NOT NULL AND delivered_at < ? AND event_id IN (SELECT event_id FROM staging_line_events WHERE delivered_at IS NOT NULL AND delivered_at < ? ORDER BY delivered_at LIMIT ?)` ,cutoff,4],
 ['compacted',`UPDATE staging_line_events SET reply=NULL WHERE delivered_at IS NOT NULL AND delivered_at < ? AND reply IS NOT NULL AND event_id IN (SELECT event_id FROM staging_line_events WHERE delivered_at IS NOT NULL AND delivered_at < ? AND reply IS NOT NULL ORDER BY delivered_at LIMIT ?)` ,replyCutoff,2]];
 for(const [kind,sql,before,cost] of operations){
  // Bound both runtime and quota consumption, even with an unexpectedly large backlog.
  for(let batch=0;batch<100;batch++){
   const limit=Math.min(batchSize,Math.floor((writeBudget-result.writes)/cost));
   if(limit<1){result.budgetExhausted=true;return result;}
   const response=await query(sql,[before,before,limit]);
   const changed=Number(response.meta?.changes||0),writes=Number(response.meta?.rows_written??changed*cost);
   result[kind]+=changed;result.writes+=writes;
   if(!changed)break;
   if(batch===99)result.budgetExhausted=true;
  }
 }
 return result;
}
