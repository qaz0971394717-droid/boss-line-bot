import test from 'node:test';
import assert from 'node:assert/strict';
import {createHelpFlex} from '../src/help-flex.js';
import {knownCommand} from '../src/command-filter.js';
test('help cards keep destructive operations as examples and buttons read-only',()=>{
 for(const section of ['common','advanced','admin']){
  const card=createHelpFlex(section,new Date('2026-10-17T17:00:00Z'));
  assert.equal(card.type,'flex');assert.equal(card.contents.type,'bubble');
  for(const b of card.contents.footer.contents){assert.equal(b.action.type,'message');assert.ok(knownCommand(b.action.text));assert.ok(['KB','王列表','進階指令','管理指令','測試','群組ID','指令','指令文字','進階指令文字','管理指令文字'].includes(b.action.text));assert.ok(b.action.label.length<=20);}
 }
 const basic=JSON.stringify(createHelpFlex());assert.ok(!basic.includes('清除KB'));
 const advanced=JSON.stringify(createHelpFlex('advanced',new Date('2026-10-17T17:00:00Z')));assert.match(advanced,/2026-10-18 2310/);assert.match(advanced,/60 秒/);
});
