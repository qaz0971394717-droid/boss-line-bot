// Pure LINE Flex builders. Data shape follows LINE Messaging API.
const tz="Asia/Taipei";
const parts=(date)=>Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:tz,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map(p=>[p.type,p.value]));
const dateKey=date=>new Intl.DateTimeFormat("sv-SE",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const lineTime=date=>{const p=parts(date);return `${p.hour}:${p.minute}:${p.second}`;};
const titleText=(text,color="#1E293B")=>({type:"text",text,size:"xs",weight:"bold",color});
export function createKbFlex(rows){
 if(!rows.length)return {type:"text",text:"📋 目前沒有 BOSS 紀錄。\n\n現在記錄：K 大象H\n手動補登：K 大象H 1022"};
 const cards=[];let contents=[],count=0;
 const flush=()=>{if(!contents.length)return;cards.push({type:"bubble",size:"mega",body:{type:"box",layout:"vertical",paddingAll:"12px",contents},footer:{type:"box",layout:"horizontal",contents:[titleText("時區: Asia/Taipei"),{...titleText(""),align:"end"}]}});contents=[];count=0;};
 const groups=new Map();
 for(const row of rows){const key=dateKey(new Date(row.respawn_time));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 for(const [date,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const weekday=new Intl.DateTimeFormat("zh-TW",{timeZone:tz,weekday:"short"}).format(new Date(items[0].respawn_time));
  if(contents.length&&count+items.length+1>13)flush();
  contents.push({type:"box",layout:"vertical",backgroundColor:"#E1E8F1",cornerRadius:"5px",paddingAll:"6px",contents:[titleText(`${date.slice(5).replace("-","/")} ${weekday}`)]});count++;
  for(const item of items){
   if(count>=13)flush();
   contents.push({type:"box",layout:"horizontal",margin:"sm",spacing:"sm",alignItems:"center",contents:[
    {...titleText(lineTime(new Date(item.respawn_time)),"#111827"),flex:3},
    {type:"box",layout:"vertical",flex:6,backgroundColor:"#D9E8FC",cornerRadius:"5px",paddingAll:"6px",contents:[titleText(String(item.boss_name),"#2563C5")]},
    {type:"box",layout:"vertical",flex:3,backgroundColor:"#2563C5",cornerRadius:"6px",paddingAll:"5px",contents:[{type:"text",text:"⚔ K王",size:"xxs",weight:"bold",color:"#FFFFFF",align:"center"}],action:{type:"postback",label:"⚔ K王",data:"kbkill:"+item.boss_name}}
   ]});count++;
  }
 }
 flush();
 for(let i=0;i<cards.length;i++)cards[i].footer.contents[1].text=`${i+1}/${cards.length}`;
 // LINE carousel supports at most 12 bubbles; caller should handle overflow explicitly.
 if(cards.length>12)return {type:"text",text:"❌ KB 卡片超過 LINE 單次顯示上限，請縮小查詢範圍。"};
 return {type:"flex",altText:"BOSS 重生時間表",contents:{type:"carousel",contents:cards}};
}
