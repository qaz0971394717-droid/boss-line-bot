import test from "node:test";
import assert from "node:assert/strict";
import { reminderPayload,cancelPayload,stagingReminderRequest } from "../src/reminders.js";
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
