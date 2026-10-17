export const BIRTHDAY_COMMAND = '多多綠大姊按一下';
export const BIRTHDAY_POSTBACK = 'birthday:duoduogreen';
export const BIRTHDAY_CHAT_ID = 'Cb6a98e7cead691d3f43cf6a743f34191';

export function birthdayEnabled(env, chatId) {
  if (env.ENABLE_BIRTHDAY_SURPRISE !== 'true') return false;
  if (env.PRODUCTION_MODE === 'true') return chatId === BIRTHDAY_CHAT_ID;
  return env.STAGING_MODE === 'true' &&
    (chatId === BIRTHDAY_CHAT_ID || /^U[a-f0-9]{32}$/i.test(chatId));
}

export const birthdayGreeting = () => ({type:'text',text:"🎂 多多綠大姊，生日快樂！🎉\n\n⚔️ 打王出寶，好運滿滿！\n🎁 天天都有橘箱\n🪶 橘箱一開，羽毛就來！"});

export function addBirthdayButton(message, env, chatId) {
  if (!birthdayEnabled(env, chatId)) return message;
  const action = {type:'postback',label:BIRTHDAY_COMMAND,data:BIRTHDAY_POSTBACK,displayText:BIRTHDAY_COMMAND};
  if (message.type !== 'flex') return {...message,quickReply:{items:[{type:'action',action}]}};
  const result = structuredClone(message);
  const first = result.contents.type === 'carousel' ? result.contents.contents[0] : result.contents;
  first.footer = {type:'box',layout:'vertical',spacing:'sm',contents:[
    ...(first.footer ? [first.footer] : []),
    {type:'button',height:'sm',style:'primary',color:'#16A34A',action}
  ]};
  return result;
}
