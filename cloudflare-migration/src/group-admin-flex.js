// Admin card for the staging bot's private chat. Buttons only send the existing
// password-protected commands, so the card itself never changes any data.
const MAX_ROWS=10;
const tz='Asia/Taipei';
const day=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:tz,month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
const tail=id=>`…${String(id).slice(-6)}`;
const text=(value,extra={})=>({type:'text',text:value,wrap:true,size:'sm',color:'#334155',...extra});
const button=(label,command,color)=>({type:'button',height:'sm',style:'primary',color,flex:0,action:{type:'message',label,text:command}});
const entry=(row,buttons,note)=>({type:'box',layout:'horizontal',alignItems:'center',margin:'md',spacing:'sm',contents:[
 {type:'box',layout:'vertical',flex:1,contents:[text(row.group_name||'（名稱未知）',{weight:'bold',color:row.group_name?'#0F172A':'#94A3B8'}),text(`${note}・ID ${tail(row.chat_id)}`,{size:'xs',color:'#64748B'})]},
 {type:'box',layout:'vertical',flex:0,spacing:'xs',contents:buttons}
]});
const section=(title,rows,build)=>[text(`${title}（${rows.length}）`,{weight:'bold',color:'#1E3A8A',margin:'lg'}),
 ...(rows.length?rows.slice(0,MAX_ROWS).map(build):[text('目前沒有',{size:'xs',color:'#94A3B8',margin:'sm'})]),
 ...(rows.length>MAX_ROWS?[text(`還有 ${rows.length-MAX_ROWS} 個未顯示，請改用「撤銷群組授權 群組ID」`,{size:'xs',color:'#B45309',margin:'sm'})]:[])];

export function createGroupAdminFlex(rows){
 const approved=rows.filter(r=>r.status==='approved');
 const pending=rows.filter(r=>r.status==='pending');
 const approvedNote=row=>row.approved_by==='grandfathered'?'舊群組（原本就在使用）':`${day(row.approved_at)} 授權`;
 const body=[
  ...section('已授權群組',approved,row=>{
   const paused=Number(row.paused)===1;
   return entry(row,[
    paused?button('恢復',`恢復群組 ${row.chat_id}`,'#16A34A'):button('暫停',`暫停群組 ${row.chat_id}`,'#D97706'),
    button('撤銷',`撤銷群組授權 ${row.chat_id}`,'#DC2626')
   ],paused?`⏸ 已暫停（回覆連線逾時）・${approvedNote(row)}`:approvedNote(row));
  }),
  {type:'separator',margin:'lg'},
  ...section('等待核准',pending,row=>entry(row,[button('授權',`授權群組 ${row.chat_id}`,'#16A34A'),button('移除',`移除申請 ${row.chat_id}`,'#64748B')],`${day(row.requested_at)} 申請`))
 ];
 return {type:'flex',altText:`群組管理｜已授權 ${approved.length}・待核准 ${pending.length}`,contents:{type:'bubble',size:'mega',
  header:{type:'box',layout:'vertical',backgroundColor:'#1E3A8A',paddingAll:'12px',contents:[
   text('🔐 群組授權管理',{size:'md',weight:'bold',color:'#FFFFFF'}),
   text('暫停／恢復立即生效；授權、撤銷需 60 秒內輸入管理密碼',{size:'xxs',color:'#BFDBFE',margin:'xs'})]},
  body:{type:'box',layout:'vertical',paddingAll:'12px',contents:body},
  footer:{type:'box',layout:'vertical',spacing:'sm',contents:[...(pending.length?[{type:'button',height:'sm',style:'secondary',action:{type:'message',label:`全部移除待核准（${pending.length}）`,text:'移除待核准'}}]:[]),{type:'button',height:'sm',style:'secondary',action:{type:'message',label:'重新整理',text:'群組管理'}}]}}};
}
