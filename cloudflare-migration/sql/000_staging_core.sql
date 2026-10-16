-- Apply ONLY to a new, isolated staging database. Never use the production DATABASE_URL.
-- Creates the core schema expected by cloudflare-migration and seeds the 62 default bosses.
CREATE TABLE IF NOT EXISTS boss_types (
  boss_key TEXT PRIMARY KEY,
  boss_name TEXT NOT NULL,
  minutes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boss_kills (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  boss_key TEXT NOT NULL,
  boss_name TEXT NOT NULL,
  kill_time TIMESTAMPTZ NOT NULL,
  respawn_time TIMESTAMPTZ NOT NULL,
  UNIQUE (chat_id, boss_key)
);

CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY,
  half_mode BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO boss_types (boss_key, boss_name, minutes) VALUES
  ('沼澤h', '沼澤H', 1440),
  ('倒塌h', '倒塌H', 720),
  ('沙漠h', '沙漠H', 720),
  ('阿德h', '阿德H', 720),
  ('生命h', '生命H', 720),
  ('掠奪h', '掠奪H', 720),
  ('廢墟h', '廢墟H', 720),
  ('激戰h', '激戰H', 720),
  ('扭曲h', '扭曲H', 720),
  ('灰色h', '灰色H', 720),
  ('時光h', '時光H', 1440),
  ('伐木h', '伐木H', 1440),
  ('山峰h', '山峰H', 1440),
  ('歐奎h', '歐奎H', 1440),
  ('涼風h', '涼風H', 1440),
  ('巨大h', '巨大H', 1440),
  ('743', '743', 720),
  ('z2', 'z2', 720),
  ('大象h', '大象H', 1440),
  ('蠍子h', '蠍子H', 1440),
  ('火狗h', '火狗H', 1440),
  ('船長h', '船長H', 1440),
  ('競技場h', '競技場H', 1440),
  ('745', '745', 1440),
  ('z4', 'Z4', 1440),
  ('公墓2', '公墓2', 1440),
  ('公墓3', '公墓3', 1440),
  ('公墓4', '公墓4', 1440),
  ('1gh', '1GH', 2880),
  ('2gh', '2GH', 2880),
  ('3gh', '3GH', 2880),
  ('5gh', '5GH', 2880),
  ('6gh', '6GH', 2880),
  ('7gh', '7GH', 2880),
  ('伐木1', '伐木1', 1440),
  ('倒塌1', '倒塌1', 720),
  ('山峰1', '山峰1', 1440),
  ('巨大1', '巨大1', 1440),
  ('廢墟1', '廢墟1', 720),
  ('扭曲1', '扭曲1', 720),
  ('掠奪1', '掠奪1', 720),
  ('時光1', '時光1', 1440),
  ('歐奎1', '歐奎1', 1440),
  ('沙漠1', '沙漠1', 720),
  ('沼澤1', '沼澤1', 1440),
  ('涼風1', '涼風1', 1440),
  ('激戰1', '激戰1', 720),
  ('灰色1', '灰色1', 720),
  ('生命1', '生命1', 720),
  ('阿德1', '阿德1', 720),
  ('雪怪1', '雪怪1', 1440),
  ('大象1', '大象1', 1440),
  ('火狗1', '火狗1', 1440),
  ('競技場1', '競技場1', 1440),
  ('船長1', '船長1', 1440),
  ('蠍子1', '蠍子1', 1440),
  ('1g1', '1G1', 2880),
  ('2g1', '2G1', 2880),
  ('3g1', '3G1', 2880),
  ('5g1', '5G1', 2880),
  ('6g1', '6G1', 2880),
  ('7g1', '7G1', 2880)
ON CONFLICT (boss_key) DO NOTHING;
