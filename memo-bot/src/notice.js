export function getNoticeMinutes(item,now=Date.now()){
 return item.notice_minutes===null||item.notice_minutes===undefined
  ?(new Date(item.due_at).getTime()-now<=600000?0:10):Number(item.notice_minutes);
}
export function noticeLabel(minutes){
 if(minutes===0)return '準時';
 if(minutes%1440===0)return '提前'+minutes/1440+'天';
 if(minutes%60===0)return '提前'+minutes/60+'小時';
 return '提前'+minutes+'分鐘';
}
export function noticeError(item,minutes,now=Date.now()){
 if(!Number.isInteger(minutes)||minutes<0||minutes>10080)return '提醒時間請設為 0～10080 分鐘（最多提前7天）。';
 const due=new Date(item.due_at).getTime();
 if(!Number.isFinite(due)||due<=now)return '事項時間已過或未設定時間，請重新建立提醒。';
 if(due-minutes*60000<=now)return '這個提前通知時間已經過了，請選短一點的提前時間，或改成準時提醒。';
 return null;
}
