import test from 'node:test';
import assert from 'node:assert/strict';
import {reportBackup} from './service-backup-status.mjs';
function fixture(){let issue;const pushes=[];return {pushes,get issue(){return issue;},async fetcher(url,o){const p=o.body?JSON.parse(o.body):{};if(o.method==='GET')return Response.json(issue?.state!=='closed'&&issue?[issue]:[]);if(o.method==='POST')issue={...p,number:7,user:{login:'github-actions[bot]'}};else Object.assign(issue,p);return Response.json(issue);},async notify(p){pushes.push(p);return true;}};}
test('backup incidents notify once, keep the same incident and recover once',async()=>{const f=fixture(),base={...f,target:'memo',title:'memo',repo:'owner/repo',run:'1'};
 await reportBackup({...base,status:'success'});assert.equal(f.pushes.length,0);
 await reportBackup({...base,status:'failure'});assert.equal(f.pushes.length,1);
 await reportBackup({...base,status:'failure'});assert.equal(f.pushes.length,1);assert.match(f.issue.body,/line-alert-sent/);
 await reportBackup({...base,status:'success'});assert.equal(f.pushes.length,2);assert.equal(f.pushes[1].kind,'recovery');assert.equal(f.issue.state,'closed');
 await reportBackup({...base,status:'success'});assert.equal(f.pushes.length,2);
});
test('LINE failure keeps a GitHub incident and the next attempt retries the same incident',async()=>{const f=fixture(),base={...f,target:'parts',title:'parts',repo:'owner/repo',run:'1'};
 await assert.rejects(reportBackup({...base,status:'failure',notify:async()=>{throw Error('network');}}));
 assert.equal(f.issue.number,7);assert.doesNotMatch(f.issue.body,/line-alert-sent/);
 await reportBackup({...base,status:'failure'});assert.equal(f.pushes[0].incident,7);
});
