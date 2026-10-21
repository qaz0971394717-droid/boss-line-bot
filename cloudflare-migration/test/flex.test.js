import test from "node:test";
import assert from "node:assert/strict";
import { createKbFlex, remainingText } from "../src/flex.js";

test("empty KB is text",()=>{
 assert.equal(createKbFlex([]).type,"text");
});
test("KB produces a LINE carousel with one-click postback",()=>{
 const result=createKbFlex([{boss_name:"大象H",respawn_time:"2026-10-16T06:30:25.000Z"}]);
 assert.equal(result.type,"flex");
 assert.equal(result.contents.type,"carousel");
 const card=result.contents.contents[0];
 const row=card.body.contents.find(x=>x.type==="box"&&x.layout==="horizontal");
 assert.equal(row.contents[2].action.data,"kbkill:大象H");
 assert.equal(card.footer.contents[1].text,"1/1");
});
test("KB card pagination caps row count",()=>{
 const rows=Array.from({length:20},(_,i)=>({boss_name:"王"+i,respawn_time:"2026-10-16T06:30:25.000Z"}));
 const result=createKbFlex(rows);
 assert.equal(result.type,"flex");
 assert.ok(result.contents.contents.length>=2);
 for(const card of result.contents.contents)assert.ok(card.body.contents.filter(x=>x.layout==="horizontal").length<=13);
});
test("KB rows show countdown and status colours",()=>{
 const now=new Date("2026-10-16T06:00:00.000Z");
 const result=createKbFlex([
  {boss_name:"已到",respawn_time:"2026-10-16T05:59:00.000Z"},
  {boss_name:"快到",respawn_time:"2026-10-16T06:12:00.000Z"},
  {boss_name:"還久",respawn_time:"2026-10-16T08:15:00.000Z"}
 ],now);
 const rows=result.contents.contents[0].body.contents.filter(x=>x.layout==="horizontal");
 assert.deepEqual(rows.map(r=>r.contents[0].contents[1].text),["🔥 已重生","12分後","2時15分後"]);
 assert.deepEqual(rows.map(r=>r.contents[1].backgroundColor),["#FEE2E2","#FEF3C7","#D9E8FC"]);
 assert.ok(JSON.stringify(result.contents.contents[0].header).includes("共 3 隻"));
});
test("remaining time formats days",()=>{
 assert.equal(remainingText(26*3600*1000),"1天2時後");
});
test("very large KB falls back to compact rows under LINE size limit",()=>{
 const rows=Array.from({length:55},(_,i)=>({boss_name:"黑龍王"+i,respawn_time:"2026-10-16T06:30:25.000Z"}));
 const result=createKbFlex(rows,new Date("2026-10-16T06:00:00.000Z"));
 assert.ok(Buffer.byteLength(JSON.stringify(result))<50000);
});
