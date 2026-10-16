import test from "node:test";
import assert from "node:assert/strict";
import { reminderPayload,cancelPayload,stagingReminderRequest,reminderWarning } from "../src/reminders.js";
test("schedule payload compatible with original reminder worker",()=>{
 const p=reminderPayload("group","大象H","2026-10-16T06:30:00Z");
 assert.deepEqual(Object.keys(p),["chatId","bossKey","bossName","respawnAt"]);
 assert.equal(p.bossKey,"大象h");
});
test("cancel payload includes scoped chat",()=>{
 assert.deepEqual(cancelPayload("group","大象H"),{chatId:"group",bossKey:"大象h"});
});
test("reminders disabled by default and cannot call network",async()=>{
 const result=await stagingReminderRequest({}, "/schedule",{},()=>{throw Error("network must not be called");});
 assert.equal(result.sent,false);
});
test("staging reminders require independent credentials",async()=>{
 const result=await stagingReminderRequest({STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",REMINDER_WORKER_URL:"https://production.example"}, "/schedule",{},()=>{throw Error("network must not be called");});
 assert.equal(result.reason,"not-configured");
});

test("explicitly enabled staging reminder sends compatible request",async()=>{
 let call;
 const fetcher=async (url,init)=>{call={url,init};return {ok:true,status:200};};
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging-reminder.example/",STAGING_REMINDER_API_KEY:"staging-test-key"};
 const result=await stagingReminderRequest(env,"/schedule",reminderPayload("g1","大象H","2026-10-16T07:30:00Z"),fetcher);
 assert.equal(result.sent,true);
 assert.equal(call.url,"https://staging-reminder.example/schedule");
 assert.equal(call.init.method,"POST");
 assert.equal(JSON.parse(call.init.body).chatId,"g1");
 assert.equal(call.init.headers.Authorization,"Bearer staging-test-key");
});
test("staging reminder reports server failure",async()=>{
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging-reminder.example/",STAGING_REMINDER_API_KEY:"test"};
 const result=await stagingReminderRequest(env,"/cancel",cancelPayload("g1","大象H"),async()=>({ok:false,status:503}));
 assert.deepEqual(result,{sent:false,status:503});
});

test("staging reminders reject exact live endpoint",async()=>{
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://reminder.example/",REMINDER_WORKER_URL:"https://reminder.example",STAGING_REMINDER_API_KEY:"staging"};
 const result=await stagingReminderRequest(env,"/schedule",{},()=>{throw Error("should never reach live endpoint");});
 assert.equal(result.reason,"production-endpoint");
});
test("staging reminders reject reused production API key",async()=>{
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging.example",STAGING_REMINDER_API_KEY:"same",REMINDER_API_KEY:"same"};
 const result=await stagingReminderRequest(env,"/schedule",{},()=>{throw Error("should never use production key");});
 assert.equal(result.reason,"production-key");
});
test("network errors do not fail the LINE callback",async()=>{
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging.example",STAGING_REMINDER_API_KEY:"test"};
 const result=await stagingReminderRequest(env,"/schedule",{},async()=>{throw Error("connection failed");});
 assert.deepEqual(result,{sent:false,reason:"network-error"});
});
test("only schedule and cancel reminder paths are permitted",async()=>{
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging.example",STAGING_REMINDER_API_KEY:"test"};
 const result=await stagingReminderRequest(env,"/admin",{},()=>{throw Error("must not call");});
 assert.equal(result.reason,"invalid-path");
});

test("do not warn when staging reminders are intentionally disabled",()=>{
 assert.equal(reminderWarning({}, {sent:false,reason:"disabled"}),"");
});
test("show user a warning when enabled reminder schedule fails",()=>{
 const warning=reminderWarning({ENABLE_STAGING_REMINDERS:"true"},{sent:false,status:503},"排程");
 assert.match(warning,/提醒排程失敗/);
 assert.match(warning,/503/);
 assert.match(warning,/請勿依賴本次提醒/);
});
test("do not warn when reminder was delivered successfully",()=>{
 assert.equal(reminderWarning({ENABLE_STAGING_REMINDERS:"true"},{sent:true,status:200}),"");
});
test("reminder paths preserve a staging base path",async()=>{
 let url;
 const env={STAGING_MODE:"true",ENABLE_STAGING_REMINDERS:"true",STAGING_REMINDER_WORKER_URL:"https://staging.example/internal/",STAGING_REMINDER_API_KEY:"staging"};
 const result=await stagingReminderRequest(env,"/cancel",{},async (u)=>{url=u;return {ok:true,status:200};});
 assert.equal(result.sent,true);
 assert.equal(url,"https://staging.example/internal/cancel");
});
