import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateReceipt,cleanEvents,INDEX_SQL} from './retention-core.mjs';
export function warningsFor({size,reads,writes,backupStatus,cleanupStatus,budgetExhausted}){
 const warnings=[];
 if(size>=250*1024*1024)warnings.push('資料庫容量已達 250 MiB 警戒門檻');
 if(reads>=2500000)warnings.push('帳號每日讀取量已達免費額度 50%');
 if(writes>=50000)warnings.push('帳號每日寫入量已達免費額度 50%');
 if(backupStatus&&backupStatus!=='success')warnings.push('備份未成功，已停止自動清理');
 if(cleanupStatus&&cleanupStatus!=='success')warnings.push('清理未成功或未執行，請檢查工作流程');
 if(budgetExhausted)warnings.push('清理已達本次寫入預算，可能有待處理積壓');
 return warnings;
}
async function main(){
 const [mode,target]=process.argv.slice(2);
 if(!['cleanup','monitor'].includes(mode)||!['production','staging'].includes(target))throw Error('Invalid maintenance arguments');
 const config=target==='production'?'wrangler.production.toml':'wrangler.d1-staging.toml';
 const databaseId=readFileSync(config,'utf8').match(/database_id\s*=\s*"([a-f0-9-]+)"/)?.[1];
 if(!databaseId)throw Error('D1 binding missing');
 const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
 const root=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}`;
 async function request(url,body){
  const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok||data.errors?.length||data.success===false)throw Error('Cloudflare maintenance API unavailable');return data;
 }
 const query=async(sql,params=[])=>{const result=(await request(root+'/query',{sql,params})).result[0];if(!result.success)throw Error('D1 maintenance query failed');return result;};
 const date=new Date().toISOString().slice(0,10);
 const analytics=await request('https://api.cloudflare.com/client/v4/graphql',{query:'query($a:string!,$d:Date){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$d,date_leq:$d}){sum{rowsRead rowsWritten}}}}}',variables:{a:account,d:date}});
 const totals=analytics.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups.reduce((sum,row)=>({reads:sum.reads+(row.sum.rowsRead||0),writes:sum.writes+(row.sum.rowsWritten||0)}),{reads:0,writes:0});
 if(mode==='cleanup'){
  const receipt=JSON.parse(readFileSync(process.env.D1_BACKUP_RECEIPT,'utf8'));
  validateReceipt(receipt,{databaseId,prefix:`d1-${target}/daily/`});
  const budget=Math.max(0,Math.min(30000,100000-totals.writes-20000));
  if(budget<1000)throw Error('Insufficient daily write headroom; cleanup deferred');
  let indexWrites=0;
  for(const sql of INDEX_SQL)indexWrites+=Number((await query(sql)).meta?.rows_written||0);
  const result=await cleanEvents(query,{writeBudget:Math.max(0,budget-indexWrites)});
  if(process.env.D1_MAINTENANCE_RESULT)writeFileSync(process.env.D1_MAINTENANCE_RESULT,JSON.stringify(result),{mode:0o600});
  console.log(JSON.stringify({target,...result,indexWrites}));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### ${target} D1 空間維護\n\n已刪除過期去重紀錄：${result.deleted}；已釋放完整回覆：${result.compacted}；本次清理寫入：${result.writes} 列。\n\n報王資料與未完成紀錄均保留。\n`);
  return;
 }
 const info=(await request(root)).result;
 let result={};try{result=JSON.parse(readFileSync(process.env.D1_MAINTENANCE_RESULT,'utf8'));}catch{}
 const warnings=warningsFor({size:info.file_size,reads:totals.reads,writes:totals.writes,backupStatus:process.env.D1_BACKUP_STATUS,cleanupStatus:process.env.D1_CLEANUP_STATUS,budgetExhausted:result.budgetExhausted});
 const body=`資料庫：${target}\n容量：${(info.file_size/1024/1024).toFixed(2)} MiB\n帳號今日讀取：${totals.reads} / 5,000,000 列\n帳號今日寫入：${totals.writes} / 100,000 列\n\n${warnings.map(x=>'- '+x).join('\n')}\n\n目前不會自動刪除王設定、報王紀錄或未完成訊息。請檢查 Actions 紀錄及流量。\n工作流程：https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
 console.log(JSON.stringify({target,size_bytes:info.file_size,...totals,warnings}));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n容量：${(info.file_size/1024/1024).toFixed(2)} MiB；今日帳號讀取 ${totals.reads}、寫入 ${totals.writes} 列。\n\n${warnings.length?warnings.join('\n'):'檢查正常，未達警戒門檻。'}\n`);
 if(!process.env.GH_TOKEN)throw Error('GitHub issue authorization missing');
 const repository=process.env.GITHUB_REPOSITORY;
 const title=`D1 空間或用量警示（${target}）`;
 async function gh(path,method='GET',payload){const response=await fetch(`https://api.github.com/repos/${repository}${path}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,'Content-Type':'application/json','Accept':'application/vnd.github+json'},body:payload?JSON.stringify(payload):undefined});if(!response.ok)throw Error('GitHub alert API failed');return response.json();}
 const issues=await gh('/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100');
 const existing=issues.find(issue=>issue.title===title&&!issue.pull_request&&issue.user?.login==='github-actions[bot]');
 if(warnings.length){
  if(existing)await gh('/issues/'+existing.number,'PATCH',{body});else await gh('/issues','POST',{title,body});
  for(const warning of warnings)console.log('::warning::'+warning);
 }else if(existing&&process.env.D1_BACKUP_STATUS==='success'&&process.env.D1_CLEANUP_STATUS==='success'){await gh('/issues/'+existing.number,'PATCH',{state:'closed',body:body+'\n\n本次檢查已恢復正常，自動關閉警示。'});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('::error::D1 maintenance stopped safely:',error.name);process.exitCode=1;});
