import {notifyOps} from '../cloudflare-migration/scripts/notify-ops.mjs';
export async function reportBackup({target,title,status,repo=process.env.GITHUB_REPOSITORY,run=process.env.GITHUB_RUN_ID,token=process.env.GH_TOKEN,fetcher=fetch,notify=notifyOps}){
 const ok=status==='success',marker='<!-- line-alert-sent -->';
 async function api(path,method='GET',payload){const r=await fetcher(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/vnd.github+json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Backup issue update failed');return r.json();}
 const issues=await api('/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100');
 const old=issues.find(i=>i.title===title&&!i.pull_request&&i.user?.login==='github-actions[bot]');
 const body=`${title}：${ok?'備份及容量檢查已恢復正常':'備份或容量檢查未成功，請檢查工作流程'}。\n\nhttps://github.com/${repo}/actions/runs/${run}`;
 if(ok&&!old)return;
 if(ok){
  if(!await notify({target,kind:'recovery',incident:old.number}))throw Error('LINE recovery destination unavailable');
  await api('/issues/'+old.number,'PATCH',{state:'closed',body});return;
 }
 const issue=old||await api('/issues','POST',{title,body});
 // Persist the GitHub incident first; the stable incident ID makes LINE retries safe.
 let sent=Boolean(issue.body?.includes(marker));
 if(!sent)sent=await notify({target,kind:'alert',message:'每日備份或容量檢查失敗，請查看 GitHub Actions。',incident:issue.number});
 await api('/issues/'+issue.number,'PATCH',{body:body+(sent?'\n'+marker:'')});
 if(!sent)throw Error('LINE alert destination unavailable');
}
