import test from "node:test";
import assert from "node:assert/strict";
import { isAdminCommand,parseAdminCommand,processAdminCommand,applyAdminAction } from "../src/admin.js";

test("recognizes administrator commands",()=>{
 assert.equal(isAdminCommand("新增王 黑龍1 720"),true);
 assert.equal(isAdminCommand("K 黑龍1"),false);
});
test("parses batched bosses and minutes",()=>{
 assert.deepEqual(parseAdminCommand("批次新增王 黑龍1、白龍1 720"),{kind:"批次新增王",names:["黑龍1","白龍1"],minutes:720});
});
test("rejects invalid minutes and names",()=>{
 assert.equal(parseAdminCommand("新增王 黑龍1 0"),null);
 assert.equal(parseAdminCommand("修改王 黑龍1 720x"),null);
 assert.equal(parseAdminCommand("刪除王 a b"),null);
});
test("staging admin opt-in protects ordinary commands and avoids SQL",async()=>{
 const sql=()=>{throw Error("SQL must not be called");};
 assert.equal(await processAdminCommand("K 黑龍1","g",{},sql),null);
 assert.match((await processAdminCommand("新增王 黑龍1 720","g",{},sql)).text,/尚未啟用/);
});
test("administrator challenges expire after sixty seconds",async()=>{
 const sql=async()=>[{command:"新增王 黑龍1 720",expires_at:"2026-10-16T08:00:00Z"}];
 const result=await processAdminCommand("pass","g",{STAGING_MODE:"true",ENABLE_STAGING_ADMIN:"true",ADMIN_PASSWORD:"pass"},sql,new Date("2026-10-16T08:01:01Z"));
 assert.match(result.text,/逾時/);
});
test("incorrect password cancels action without changing boss catalog",async()=>{
 let calls=0;
 const sql=async()=>{calls++;return [{command:"新增王 黑龍1 720",expires_at:"2026-10-16T08:02:00Z"}];};
 const result=await processAdminCommand("bad","g",{STAGING_MODE:"true",ENABLE_STAGING_ADMIN:"true",ADMIN_PASSWORD:"correct"},sql,new Date("2026-10-16T08:01:00Z"));
 assert.match(result.text,/密碼錯誤/);
 assert.equal(calls,1);
});

test("deleting a boss cancels reminders for each affected group",async()=>{
 const statements=[];
 const sql=async(strings,...values)=>{
  const query=strings.join("?");statements.push({query,values});
  if(query.includes("DELETE FROM boss_types"))return [{boss_name:"黑龍1"}];
  if(query.includes("DELETE FROM boss_kills"))return [{chat_id:"group-A",boss_name:"黑龍1"},{chat_id:"group-B",boss_name:"黑龍1"}];
  return [];
 };
 const result=await applyAdminAction({kind:"刪除王",names:["黑龍1"]},sql,{});
 assert.match(result.text,/成功/);
 assert.equal(statements.length,2);
 assert.equal(statements[1].values[0],"黑龍1".toLowerCase());
});
test("admin deletion of an unknown boss leaves group records untouched",async()=>{
 let operations=0;
 const sql=async()=>{operations++;return [];};
 const reply=await applyAdminAction({kind:"刪除王",names:["不存在"]},sql,{});
 assert.match(reply.text,/未處理/);
 assert.equal(operations,1);
});
