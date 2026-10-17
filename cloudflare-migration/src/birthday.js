export const BIRTHDAY_COMMAND = '多多綠大姊按一下';
export const BIRTHDAY_POSTBACK = 'birthday:duoduogreen';
export const BIRTHDAY_CHAT_ID = 'Cb6a98e7cead691d3f43cf6a743f34191';

export const birthdayEnabled = (env, chatId) =>
  env.STAGING_MODE === 'true' && env.PRODUCTION_MODE !== 'true' &&
  env.ENABLE_BIRTHDAY_SURPRISE === 'true' && chatId === BIRTHDAY_CHAT_ID;

export const birthdayGreeting = () => ({type:'text',text:
  '🎂 多多綠大姊，生日快樂！🎉\n\n打王出寶，天天都有橘箱 橘箱出羽毛'
});

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
