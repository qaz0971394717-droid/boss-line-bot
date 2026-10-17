// Help cards show editable examples. Buttons only query data or open help.
const text=(value,extra={})=>({type:'text',text:value,wrap:true,size:'sm',color:'#334155',...extra});
const row=(title,example,note)=>({type:'box',layout:'vertical',spacing:'xs',margin:'lg',contents:[text(title,{weight:'bold',color:'#0F172A'}),text(example,{color:'#1D4ED8',weight:'bold'}),...(note?[text(note,{size:'xs',color:'#64748B'})]:[])]});
const button=(label,command)=>({type:'button',height:'sm',style:'secondary',action:{type:'message',label,text:command}});
function card(title,subtitle,rows,buttons){return {type:'flex',altText:title+'｜輸入「指令」查看操作範例',contents:{type:'bubble',size:'mega',header:{type:'box',layout:'vertical',backgroundColor:'#EAF2FF',spacing:'sm',contents:[text(title,{size:'lg',weight:'bold'}),text(subtitle,{size:'xs',color:'#64748B'})]},body:{type:'box',layout:'vertical',paddingTop:'0px',contents:rows},footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}}};}
export function createHelpFlex(section='common',now=new Date()){
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(section==='advanced')return card('進階操作','範例中的王名、日期與時間請自行替換',[
 row('補登到秒','K 大象H 102233','表示今天 10:22:33'),
 row('補登其他日期',`K 大象H ${day} 2310`,'日期格式：年-月-日；時間 2310＝23:10'),
 row('直接指定出生時間',`修改出生 大象H ${day} 23:10:00`,'這是出生時間，不是擊殺時間'),
 row('開啟／關閉減半模式','HALF ON ／ HALF OFF','選一條輸入；輸入 HALF 可查看目前模式'),
 row('清除本群全部 KB','清除KB','機器人詢問後，由本人於 60 秒內回覆「是」；回覆「否」取消')
 ],[button('檢查運作狀態','測試'),button('查看群組 ID','群組ID'),button('回常用指令','指令')]);
 if(section==='admin')return card('王表管理','修改的是所有群組共用王表，請謹慎操作',[
 row('新增一隻王','新增王 大象H 720','720 是重生間隔分鐘數'),
 row('批次新增','批次新增王 王A、王B 720','多個王名用頓號「、」分隔'),
 row('修改重生間隔','修改王 大象H 720'),
 row('刪除王種','刪除王 大象H','會影響其他群組；不是只取消本群報王紀錄'),
 text('輸入操作後，依提示於 60 秒內輸入管理密碼。密碼錯誤或逾時會取消。',{size:'xs',margin:'lg'})
 ],[button('查看全部王名','王列表'),button('回常用指令','指令')]);
 return card('BOSS Bot 常用指令','照著輸入即可；「大象H」請換成你要的王名',[
 row('記錄現在擊殺','K 大象H','自動計算下次出生時間'),
 row('補登今天的擊殺','K 大象H 1022','表示今天 10:22 擊殺'),
 row('查看目前紀錄','KB','也可以直接點下面的「查看 KB」'),
 row('取消一隻王的紀錄','取消 大象H','多隻範例：取消 大象H 沼澤H')
 ],[button('查看 KB','KB'),button('查看全部王名','王列表'),button('日期補登・模式・清除','進階指令'),button('管理王表','管理指令')]);
}
