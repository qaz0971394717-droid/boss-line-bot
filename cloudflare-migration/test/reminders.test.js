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
