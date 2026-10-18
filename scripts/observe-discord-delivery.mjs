// Read-only tail of natural Discord alarm delivery; never sends a test message.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/hit2-boss-reminder-v2/tails';
async function api(url,method,body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
 const json=await response.json();if(!response.ok||!json.success)throw Error('Reminder tail API rejected: '+response.status);return json.result;
}
const tail=await api(root,'POST',{filters:[]});
let socket;
const result={events:0,discord_sent:0,exceptions:0,http_statuses:[]};
try{
 await new Promise((resolve,reject)=>{
  socket=new WebSocket(tail.url,'trace-v1');
  const timer=setTimeout(()=>{socket.close();resolve();},120000);
  socket.onopen=()=>socket.send(JSON.stringify({debug:false}));
  socket.onmessage=async frame=>{
   try{
    const raw=typeof frame.data==='string'?frame.data:await frame.data.text();
    const event=JSON.parse(raw);result.events++;
    for(const log of event.logs||[]){
     if(JSON.stringify(log.message||[]).includes('Discord reminder sent:'))result.discord_sent++;
    }
    for(const exception of event.exceptions||[]){
     result.exceptions++;
     const status=String(exception.message||'').match(/Discord Webhook failed:\\s*(\\d+)/);
     if(status)result.http_statuses.push(Number(status[1]));
    }
    if(result.discord_sent||result.exceptions){clearTimeout(timer);socket.close();resolve();}
   }catch{result.parse_errors=(result.parse_errors||0)+1;}
  };
  socket.onerror=()=>{clearTimeout(timer);reject(Error('Reminder log connection failed'));};
 });
 console.log('DISCORD_DELIVERY_OBSERVATION '+JSON.stringify(result));
}finally{socket?.close();await api(root+'/'+tail.id,'DELETE');console.log('Reminder observation session removed.');}
