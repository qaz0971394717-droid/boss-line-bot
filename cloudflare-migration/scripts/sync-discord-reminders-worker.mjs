import {syncFutureDiscordReminders} from './discord-reminders.js';
export default {
 async fetch(request,env){
  if(request.method!=='POST'||request.headers.get('authorization')!=='Bearer '+env.SYNC_AUTH)return new Response('Forbidden',{status:403});
  const result=await syncFutureDiscordReminders(env);
  return Response.json(result,{status:result.failed?502:200});
 }
};
