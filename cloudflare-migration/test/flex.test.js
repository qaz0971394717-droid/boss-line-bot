import test from "node:test";
import assert from "node:assert/strict";
import { createKbFlex } from "../src/flex.js";

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
