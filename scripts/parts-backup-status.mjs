const repo=process.env.GITHUB_REPOSITORY,title='零件查詢機器人：備份或容量警示',ok=process.env.BACKUP_STATUS==='success';
async function api(path,method='GET',payload){const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,'Content-Type':'application/json','Accept':'application/vnd.github+json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Parts backup alert update failed');return r.json();}
const issues=await api('/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100');
const existing=issues.find(i=>i.title===title&&!i.pull_request&&i.user?.login==='github-actions[bot]');
const body=`零件查詢每日備份${ok?'及容量檢查已恢復正常':'或容量檢查未成功，請檢查工作流程'}。\n\nhttps://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}\n\n此流程不會透過 LINE 推播。`;
if(!ok){if(existing)await api('/issues/'+existing.number,'PATCH',{body});else await api('/issues','POST',{title,body});}else if(existing)await api('/issues/'+existing.number,'PATCH',{state:'closed',body});
