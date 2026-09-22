import os
import requests
import threading
import asyncio
import discord
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import RealDictCursor

from flask import Flask, request, abort

from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration,
    ApiClient,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
    FlexMessage,
    FlexContainer,
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent


# =========================================================
# 基本設定
# =========================================================

app = Flask(__name__)

CHANNEL_ACCESS_TOKEN = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
CHANNEL_SECRET = os.environ["LINE_CHANNEL_SECRET"]
DATABASE_URL = os.environ["DATABASE_URL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
REMINDER_WORKER_URL = os.environ.get("REMINDER_WORKER_URL", "").rstrip("/")
REMINDER_API_KEY = os.environ.get("REMINDER_API_KEY", "")
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
DISCORD_KB_LINE_CHAT_ID = os.environ.get("DISCORD_KB_LINE_CHAT_ID", "")

configuration = Configuration(access_token=CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)

TZ = ZoneInfo("Asia/Taipei")

# =========================================================
# 管理員密碼驗證暫存
# =========================================================
PENDING_ADMIN_ACTIONS = {}


# =========================================================
# 預設 BOSS
# =========================================================

DEFAULT_BOSSES = {

    # =====================================================
    # H線 12小時
    # =====================================================
    "沼澤H": 1440,
    "倒塌H": 720,
    "沙漠H": 720,
    "阿德H": 720,
    "生命H": 720,
    "掠奪H": 720,
    "廢墟H": 720,
    "激戰H": 720,
    "扭曲H": 720,
    "灰色H": 720,
    "時光H": 1440,
    "伐木H": 1440,
    "山峰H": 1440,
    "歐奎H": 1440,
    "涼風H": 1440,
    "巨大H": 1440,

    # =====================================================
    # 其他 12小時
    # =====================================================
    "743": 720,
    "z2": 720,

    # =====================================================
    # H線 24小時
    # =====================================================
    "大象H": 1440,
    "蠍子H": 1440,
    "火狗H": 1440,
    "船長H": 1440,
    "競技場H": 1440,

    # =====================================================
    # 其他 24小時
    # =====================================================
    "745": 1440,
    "Z4": 1440,
    "公墓2": 1440,
    "公墓3": 1440,
    "公墓4": 1440,

    # =====================================================
    # H線 48小時
    # =====================================================
    "1GH": 2880,
    "2GH": 2880,
    "3GH": 2880,
    "5GH": 2880,
    "6GH": 2880,
    "7GH": 2880,

    # =====================================================
    # 1線 12小時
    # =====================================================
    "伐木1": 1440,
    "倒塌1": 720,
    "山峰1": 1440,
    "巨大1": 1440,
    "廢墟1": 720,
    "扭曲1": 720,
    "掠奪1": 720,
    "時光1": 1440,
    "歐奎1": 1440,
    "沙漠1": 720,
    "沼澤1": 1440,
    "涼風1": 1440,
    "激戰1": 720,
    "灰色1": 720,
    "生命1": 720,
    "阿德1": 720,
    "雪怪1": 1440,

    # =====================================================
    # 1線 24小時
    # =====================================================
    "大象1": 1440,
    "火狗1": 1440,
    "競技場1": 1440,
    "船長1": 1440,
    "蠍子1": 1440,

    # =====================================================
    # 1線 48小時
    # =====================================================
    "1G1": 2880,
    "2G1": 2880,
    "3G1": 2880,
    "5G1": 2880,
    "6G1": 2880,
    "7G1": 2880,
}


# =========================================================
# PostgreSQL
# =========================================================

def get_db():
    return psycopg2.connect(
        DATABASE_URL,
        connect_timeout=10
    )


def init_db():

    conn = get_db()

    try:
        with conn.cursor() as cur:

            # BOSS 種類
            cur.execute("""
                CREATE TABLE IF NOT EXISTS boss_types (
                    boss_key TEXT PRIMARY KEY,
                    boss_name TEXT NOT NULL,
                    minutes INTEGER NOT NULL
                )
            """)

            # BOSS 死亡紀錄
            cur.execute("""
                CREATE TABLE IF NOT EXISTS boss_kills (
                    id BIGSERIAL PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    boss_key TEXT NOT NULL,
                    boss_name TEXT NOT NULL,
                    kill_time TIMESTAMPTZ NOT NULL,
                    respawn_time TIMESTAMPTZ NOT NULL,
                    UNIQUE(chat_id, boss_key)
                )
            """)

            # 每個群組 / 聊天室自己的 HALF 狀態
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_settings (
                    chat_id TEXT PRIMARY KEY,
                    half_mode BOOLEAN NOT NULL DEFAULT FALSE
                )
            """)

            # 預設 BOSS
            for boss_name, minutes in DEFAULT_BOSSES.items():

                cur.execute("""
                    INSERT INTO boss_types (
                        boss_key,
                        boss_name,
                        minutes
                    )
                    VALUES (%s, %s, %s)

                    ON CONFLICT (boss_key)
                    DO NOTHING
                """, (
                    boss_name.lower(),
                    boss_name,
                    minutes
                ))

        conn.commit()

    finally:
        conn.close()


init_db()


# =========================================================
# 取得聊天室 / 群組 ID
# =========================================================

def get_chat_id(event):

    source = event.source

    if getattr(source, "group_id", None):
        return source.group_id

    if getattr(source, "room_id", None):
        return source.room_id

    if getattr(source, "user_id", None):
        return source.user_id

    return "unknown"



# =========================================================
# Cloudflare / Discord BOSS 提醒
# LINE 只負責報王；Cloudflare 到時間後送 Discord Webhook
# =========================================================

def reminder_request(path, payload):
    if not REMINDER_WORKER_URL or not REMINDER_API_KEY:
        print("Reminder skipped: REMINDER_WORKER_URL / REMINDER_API_KEY not configured")
        return False

    try:
        response = requests.post(
            f"{REMINDER_WORKER_URL}{path}",
            json=payload,
            headers={
                "Authorization": f"Bearer {REMINDER_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )

        if not response.ok:
            print(
                f"Reminder request failed: {response.status_code} "
                f"{response.text}"
            )
            return False

        return True

    except Exception as exc:
        print(f"Reminder request error: {exc}")
        return False


def sync_boss_reminder(chat_id, boss_name, respawn_time):
    return reminder_request(
        "/schedule",
        {
            "chatId": chat_id,
            "bossKey": boss_name.lower(),
            "bossName": boss_name,
            "respawnAt": respawn_time.astimezone(TZ).isoformat(),
        },
    )


def cancel_boss_reminder(chat_id, boss_name):
    return reminder_request(
        "/cancel",
        {
            "chatId": chat_id,
            "bossKey": boss_name.lower(),
        },
    )


# =========================================================
# HALF
# 每個 LINE 群組 / 聊天室獨立
# =========================================================

def get_half_mode(chat_id):

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT half_mode
                FROM chat_settings
                WHERE chat_id = %s
            """, (chat_id,))

            row = cur.fetchone()

            if row:
                return bool(row[0])

            return False

    finally:
        conn.close()


def set_half_mode(chat_id, enabled):

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                INSERT INTO chat_settings (
                    chat_id,
                    half_mode
                )
                VALUES (%s, %s)

                ON CONFLICT (chat_id)
                DO UPDATE SET
                    half_mode = EXCLUDED.half_mode
            """, (
                chat_id,
                enabled
            ))

        conn.commit()

    finally:
        conn.close()


def toggle_half_mode(chat_id):

    new_value = not get_half_mode(chat_id)

    set_half_mode(
        chat_id,
        new_value
    )

    return new_value


# =========================================================
# 尋找 BOSS
# =========================================================

def find_boss(input_name):

    boss_key = input_name.strip().lower()

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT boss_name, minutes
                FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))

            row = cur.fetchone()

            if row:
                return row[0], row[1]

            return None, None

    finally:
        conn.close()


# =========================================================
# 新增王
# =========================================================

def add_boss(boss_name, minutes):

    boss_name = boss_name.strip()
    boss_key = boss_name.lower()

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT 1
                FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))

            if cur.fetchone():
                return False, "這隻王已經存在。"

            cur.execute("""
                INSERT INTO boss_types (
                    boss_key,
                    boss_name,
                    minutes
                )
                VALUES (%s, %s, %s)
            """, (
                boss_key,
                boss_name,
                minutes
            ))

        conn.commit()

        return True, "新增成功"

    finally:
        conn.close()


# =========================================================
# 修改王
# =========================================================

def edit_boss(boss_name, minutes):

    boss_key = boss_name.strip().lower()

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT boss_name
                FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))

            row = cur.fetchone()

            if not row:
                return False, "找不到這隻王。"

            real_name = row[0]

            cur.execute("""
                UPDATE boss_types
                SET minutes = %s
                WHERE boss_key = %s
            """, (
                minutes,
                boss_key
            ))

        conn.commit()

        return True, real_name

    finally:
        conn.close()


# =========================================================
# 刪除王
# =========================================================

def delete_boss(boss_name):

    boss_key = boss_name.strip().lower()

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT boss_name
                FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))

            row = cur.fetchone()

            if not row:
                return False, None

            real_name = row[0]

            cur.execute("""
                SELECT chat_id
                FROM boss_kills
                WHERE boss_key = %s
            """, (boss_key,))

            affected_chat_ids = [
                item[0]
                for item in cur.fetchall()
            ]

            cur.execute("""
                DELETE FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))

            cur.execute("""
                DELETE FROM boss_kills
                WHERE boss_key = %s
            """, (boss_key,))

        conn.commit()

        for affected_chat_id in affected_chat_ids:
            cancel_boss_reminder(
                affected_chat_id,
                real_name
            )

        return True, real_name

    finally:
        conn.close()


# =========================================================
# 手動死亡時間
# 1022   = 今天 10:22:00
# 102233 = 今天 10:22:33
# =========================================================

def parse_manual_time(time_text):

    time_text = time_text.strip()

    if len(time_text) not in (4, 6):
        return None

    if not time_text.isdigit():
        return None

    hour = int(time_text[0:2])
    minute = int(time_text[2:4])
    second = 0

    if len(time_text) == 6:
        second = int(time_text[4:6])

    if not (0 <= hour <= 23):
        return None

    if not (0 <= minute <= 59):
        return None

    if not (0 <= second <= 59):
        return None

    now = datetime.now(TZ)

    return now.replace(
        hour=hour,
        minute=minute,
        second=second,
        microsecond=0
    )


# =========================================================
# 記錄死亡
# =========================================================
def record_kill(
    chat_id,
    boss_name,
    minutes,
    kill_time=None
):

    if kill_time is None:
        kill_time = datetime.now(TZ)

    half_mode = get_half_mode(chat_id)

    if half_mode:
        actual_minutes = minutes / 2
    else:
        actual_minutes = minutes

    respawn_time = (
        kill_time
        + timedelta(minutes=actual_minutes)
    )

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                INSERT INTO boss_kills (
                    chat_id,
                    boss_key,
                    boss_name,
                    kill_time,
                    respawn_time
                )
                VALUES (%s, %s, %s, %s, %s)

                ON CONFLICT (chat_id, boss_key)
                DO UPDATE SET
                    boss_name = EXCLUDED.boss_name,
                    kill_time = EXCLUDED.kill_time,
                    respawn_time = EXCLUDED.respawn_time
            """, (
                chat_id,
                boss_name.lower(),
                boss_name,
                kill_time,
                respawn_time
            ))

        conn.commit()

    finally:
        conn.close()

    # 建立 / 更新 Cloudflare 排程。
    # Cloudflare Worker 會在 5 分鐘、1 分鐘前送到 Discord。
    sync_boss_reminder(
        chat_id,
        boss_name,
        respawn_time
    )

    return (
        kill_time,
        respawn_time,
        actual_minutes,
        half_mode
    )


# =========================================================
# 同步目前聊天室既有 BOSS 到 Cloudflare / Discord
# 只同步尚未到重生時間的紀錄
# =========================================================

def sync_existing_reminders(chat_id):
    now = datetime.now(TZ)
    conn = get_db()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    boss_name,
                    respawn_time
                FROM boss_kills
                WHERE chat_id = %s
                  AND respawn_time > %s
                ORDER BY respawn_time ASC
            """, (
                chat_id,
                now
            ))

            rows = cur.fetchall()

    finally:
        conn.close()

    success_count = 0
    failed_count = 0

    for row in rows:
        if sync_boss_reminder(
            chat_id,
            row["boss_name"],
            row["respawn_time"]
        ):
            success_count += 1
        else:
            failed_count += 1

    return success_count, failed_count


# =========================================================
# RESTART
# 只清除目前聊天室死亡紀錄
# =========================================================

def restart_bosses(chat_id):

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT boss_name
                FROM boss_kills
                WHERE chat_id = %s
            """, (chat_id,))

            boss_names = [
                row[0]
                for row in cur.fetchall()
            ]

            cur.execute("""
                DELETE FROM boss_kills
                WHERE chat_id = %s
            """, (chat_id,))

            deleted_count = cur.rowcount

        conn.commit()

    finally:
        conn.close()

    for boss_name in boss_names:
        cancel_boss_reminder(
            chat_id,
            boss_name
        )

    return deleted_count


# =========================================================
# 取消單隻 BOSS 紀錄
# 只影響目前 LINE 群組 / 聊天室，不刪除固定王表
# =========================================================

def cancel_boss_record(chat_id, boss_name):
    boss_key = boss_name.strip().lower()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT boss_name
                FROM boss_types
                WHERE boss_key = %s
            """, (boss_key,))
            row = cur.fetchone()

            if not row:
                return False, None, "boss_not_found"

            real_name = row[0]

            cur.execute("""
                DELETE FROM boss_kills
                WHERE chat_id = %s
                  AND boss_key = %s
            """, (chat_id, boss_key))

            deleted_count = cur.rowcount

        conn.commit()

        if deleted_count == 0:
            return False, real_name, "record_not_found"

        cancel_boss_reminder(
            chat_id,
            real_name
        )

        return True, real_name, None
    finally:
        conn.close()


# =========================================================
# K 王完成卡片
# =========================================================

def create_kill_card(
    boss_name,
    kill_time,
    respawn_time,
    minutes,
    manual=False,
    half_mode=False
):

    if manual:
        title = f"{boss_name} 已補登"
    else:
        title = f"{boss_name} 已記錄"

    if half_mode:
        mode_text = "⚡ HALF 減半"
    else:
        mode_text = "正常"

    if float(minutes).is_integer():
        minutes_text = f"{int(minutes):,}"
    else:
        minutes_text = f"{minutes:g}"

    bubble = {

        "type": "bubble",
        "size": "kilo",

        "body": {

            "type": "box",
            "layout": "vertical",
            "paddingAll": "20px",

            "contents": [

                {
                    "type": "box",
                    "layout": "vertical",
                    "backgroundColor": (
                        "#FFF1D6"
                        if half_mode
                        else "#E5ECF5"
                    ),
                    "cornerRadius": "8px",
                    "paddingAll": "12px",

                    "contents": [

                        {
                            "type": "text",
                            "text": title,
                            "weight": "bold",
                            "size": "xl",
                            "color": (
                                "#C56A00"
                                if half_mode
                                else "#405B78"
                            ),
                            "wrap": True
                        }
                    ]
                },

                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [

                        {
                            "type": "text",
                            "text": "死亡時間",
                            "size": "sm",
                            "weight": "bold",
                            "color": "#617A96"
                        },

                        {
                            "type": "text",
                            "text": kill_time.astimezone(TZ).strftime(
                                "%Y-%m-%d %H:%M:%S"
                            ),
                            "size": "md",
                            "margin": "sm",
                            "color": "#222222"
                        }
                    ]
                },

                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [

                        {
                            "type": "text",
                            "text": "下一次重生",
                            "size": "sm",
                            "weight": "bold",
                            "color": "#617A96"
                        },

                        {
                            "type": "text",
                            "text": respawn_time.astimezone(TZ).strftime(
                                "%Y-%m-%d %H:%M:%S"
                            ),
                            "size": "md",
                            "weight": "bold",
                            "margin": "sm",
                            "color": "#222222"
                        }
                    ]
                },

                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "xl",

                    "contents": [

                        {
                            "type": "box",
                            "layout": "vertical",
                            "flex": 1,

                            "contents": [

                                {
                                    "type": "text",
                                    "text": "實際週期",
                                    "size": "sm",
                                    "weight": "bold",
                                    "color": "#617A96"
                                },

                                {
                                    "type": "text",
                                    "text": f"{minutes_text} 分鐘",
                                    "size": "md",
                                    "margin": "sm",
                                    "color": "#222222"
                                }
                            ]
                        },

                        {
                            "type": "box",
                            "layout": "vertical",
                            "flex": 1,

                            "contents": [

                                {
                                    "type": "text",
                                    "text": "模式",
                                    "size": "sm",
                                    "weight": "bold",
                                    "color": "#617A96"
                                },

                                {
                                    "type": "text",
                                    "text": mode_text,
                                    "size": "md",
                                    "margin": "sm",
                                    "color": (
                                        "#C56A00"
                                        if half_mode
                                        else "#222222"
                                    )
                                }
                            ]
                        }
                    ]
                },

                {
                    "type": "text",
                    "text": "時區：Asia/Taipei",
                    "size": "xs",
                    "margin": "xl",
                    "color": "#64748B"
                }
            ]
        }
    }

    return FlexMessage(
        alt_text=title,
        contents=FlexContainer.from_dict(bubble)
    )


# =========================================================
# 星期
# =========================================================

def weekday_tw(dt):

    names = [
        "一",
        "二",
        "三",
        "四",
        "五",
        "六",
        "日"
    ]

    return names[dt.weekday()]


# =========================================================
# 取得目前已記錄 BOSS
# =========================================================

def get_current_bosses(chat_id):

    conn = get_db()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT
                    boss_name,
                    kill_time,
                    respawn_time
                FROM boss_kills
                WHERE chat_id = %s
                ORDER BY respawn_time ASC
            """, (chat_id,))

            rows = cur.fetchall()

            result = []

            for row in rows:

                result.append({
                    "boss_name": row["boss_name"],
                    "kill_time": row["kill_time"],
                    "respawn_time": row["respawn_time"]
                })

            return result

    finally:
        conn.close()


# =========================================================
# KB 王表
# =========================================================

def create_kb_table(chat_id):

    bosses = get_current_bosses(chat_id)

    if not bosses:

        return TextMessage(
            text=(
                "📋 目前沒有 BOSS 紀錄。\n\n"
                "現在記錄：K 大象H\n"
                "手動補登：K 大象H 1022"
            )
        )

    date_groups = {}

    for item in bosses:

        respawn = item["respawn_time"].astimezone(TZ)

        date_key = respawn.strftime("%Y-%m-%d")

        if date_key not in date_groups:
            date_groups[date_key] = []

        date_groups[date_key].append(item)

    all_dates = sorted(date_groups.keys())

    cards = []
    current_contents = []
    current_rows = 0

    def add_card(contents):

        if not contents:
            return

        bubble = {

            "type": "bubble",
            "size": "mega",

            "body": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "12px",
                "contents": contents
            },

            "footer": {

                "type": "box",
                "layout": "horizontal",
                "paddingStart": "14px",
                "paddingEnd": "14px",
                "paddingTop": "10px",
                "paddingBottom": "12px",

                "contents": [

                    {
                        "type": "text",
                        "text": "時區: Asia/Taipei",
                        "size": "xs",
                        "weight": "bold",
                        "color": "#334155",
                        "flex": 1
                    },

                    {
                        "type": "text",
                        "text": "",
                        "size": "xs",
                        "weight": "bold",
                        "align": "end",
                        "color": "#334155"
                    }
                ]
            }
        }

        cards.append(bubble)

    for date_key in all_dates:

        items = date_groups[date_key]

        sample_date = items[0]["respawn_time"].astimezone(TZ)

        date_header = {

            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#E1E8F1",
            "cornerRadius": "5px",
            "paddingStart": "8px",
            "paddingEnd": "8px",
            "paddingTop": "5px",
            "paddingBottom": "5px",

            "margin": (
                "sm"
                if current_contents
                else "none"
            ),

            "contents": [

                {
                    "type": "text",
                    "text": (
                        f"{sample_date.strftime('%m/%d')} "
                        f"{weekday_tw(sample_date)}"
                    ),
                    "size": "xs",
                    "weight": "bold",
                    "color": "#1E293B"
                }
            ]
        }

        needed_rows = len(items) + 1

        if (
            current_contents
            and current_rows + needed_rows > 13
        ):

            add_card(current_contents)

            current_contents = []
            current_rows = 0

        current_contents.append(date_header)
        current_rows += 1

        for item in items:

            respawn = item["respawn_time"].astimezone(TZ)

            row = {

                "type": "box",
                "layout": "horizontal",
                "margin": "sm",
                "spacing": "sm",
                "alignItems": "center",

                "contents": [

                    {
                        "type": "text",
                        "text": respawn.strftime("%H:%M:%S"),
                        "size": "xs",
                        "weight": "bold",
                        "color": "#111827",
                        "flex": 3
                    },

                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#D9E8FC",
                        "cornerRadius": "5px",
                        "paddingStart": "8px",
                        "paddingEnd": "8px",
                        "paddingTop": "5px",
                        "paddingBottom": "5px",
                        "flex": 7,

                        "contents": [

                            {
                                "type": "text",
                                "text": item["boss_name"],
                                "size": "xs",
                                "weight": "bold",
                                "color": "#2563C5"
                            }
                        ]
                    }
                ]
            }

            current_contents.append(row)
            current_rows += 1

    add_card(current_contents)

    total_cards = len(cards)

    for index, card in enumerate(cards):

        card["footer"]["contents"][1]["text"] = (
            f"{index + 1}/{total_cards}"
        )

    carousel = {
        "type": "carousel",
        "contents": cards
    }

    return FlexMessage(
        alt_text="BOSS 重生時間表",
        contents=FlexContainer.from_dict(carousel)
    )


# =========================================================
# 王
# =========================================================

def get_boss_list(chat_id):

    bosses = get_current_bosses(chat_id)

    if not bosses:

        return (
            "目前沒有 BOSS 紀錄。\n"
            "輸入：K 大象H"
        )

    result = "👑 BOSS 重生時間\n\n"

    now = datetime.now(TZ)

    for item in bosses:

        respawn = item["respawn_time"].astimezone(TZ)

        if respawn <= now:

            remaining = "🔥 已到重生時間"

        else:

            diff = respawn - now

            total_minutes = int(
                diff.total_seconds() // 60
            )

            days = total_minutes // 1440

            hours = (
                total_minutes % 1440
            ) // 60

            minutes = total_minutes % 60

            parts = []

            if days:
                parts.append(f"{days}天")

            if hours:
                parts.append(f"{hours}小時")

            if minutes:
                parts.append(f"{minutes}分")

            remaining = " ".join(parts)

    # 避免剛好不足 1 分鐘時顯示空白
            if not remaining:
                remaining = "不到1分鐘"

        result += (
            f"⚔️ {item['boss_name']}\n"
            f"🕐 {respawn.strftime('%m/%d %H:%M:%S')}\n"
            f"⏳ {remaining}\n\n"
        )

    return result.strip()


# =========================================================
# 王列表
# =========================================================

def get_boss_names():

    conn = get_db()

    try:
        with conn.cursor() as cur:

            cur.execute("""
                SELECT boss_name, minutes
                FROM boss_types
                ORDER BY minutes ASC, boss_name ASC
            """)

            rows = cur.fetchall()

    finally:
        conn.close()

    lines = {
        "H線": {},
        "1線": {},
        "其他": {}
    }

    for boss_name, minutes in rows:

        upper_name = boss_name.upper()

        # 1GH、2GH...屬於 H線
        if upper_name.endswith("H"):

            line_name = "H線"

        # 1G1、伐木1...屬於 1線
        elif boss_name.endswith("1"):

            line_name = "1線"

        else:

            line_name = "其他"

        if minutes not in lines[line_name]:
            lines[line_name][minutes] = []

        lines[line_name][minutes].append(boss_name)

    result = "📋 BOSS 名單\n"

    for line_name in [
        "H線",
        "1線",
        "其他"
    ]:

        groups = lines[line_name]

        if not groups:
            continue

        result += (
            "\n━━━━━━━━━━\n"
            f"【{line_name}】\n"
            "━━━━━━━━━━\n"
        )

        for minutes in sorted(groups.keys()):

            if minutes % 60 == 0:

                title = f"{minutes // 60}小時"

            else:

                title = f"{minutes}分鐘"

            result += f"\n〔{title}〕\n"

            boss_list = groups[minutes]

            for i in range(
                0,
                len(boss_list),
                5
            ):

                result += (
                    "、".join(
                        boss_list[i:i + 5]
                    )
                    + "\n"
                )

    return result.strip()


# =========================================================
# 指令說明
# =========================================================

def get_help():
    return (
        "📖 BOSS Bot 使用說明\n\n"

        "⚔️【報王】\n"
        "K 王名\n"
        "→ 以目前時間記錄死亡\n"
        "例：K 大象H\n\n"

        "K 王名 時間\n"
        "→ 補登指定死亡時間\n"
        "例：K 大象H 1022\n"
        "例：K 大象H 102233\n\n"

        "📋【查詢】\n"
        "KB\n"
        "→ 查看 BOSS 重生時間表\n\n"
        "王\n"
        "→ 查看目前已記錄的 BOSS 與剩餘時間\n\n"
        "王列表\n"
        "→ 查看全部 BOSS 與重生週期\n\n"

        "↩️【報錯取消】\n"
        "取消 王名\n"
        "→ 取消目前群組這隻王的 K 王紀錄\n"
        "例：取消 大象H\n\n"
        "※ 不會刪除 BOSS\n"
        "※ 不影響其他群組\n\n"

        "⚡【HALF 模式】\n"
        "HALF\n"
        "→ 切換 HALF 開啟 / 關閉\n\n"
        "HALF ON\n"
        "→ 開啟 HALF\n\n"
        "HALF OFF\n"
        "→ 關閉 HALF\n\n"
        "※ 開啟後，新 K 的 BOSS 重生時間減半\n"
        "※ 不影響之前已記錄的 BOSS\n\n"

        "🔄【其他】\n"
        "RESTART\n"
        "→ 清除目前群組全部 K 王紀錄\n\n"
        "測試\n"
        "→ 查看 Bot 是否正常\n\n"

        "🔐 王表管理請輸入：管理指令"
    )


def get_admin_help():
    return (
        "🔐 BOSS Bot 管理指令\n\n"
        "以下操作會修改「全系統共用王表」\n"
        "所有 LINE 群組都會受到影響。\n\n"

        "➕【新增 BOSS】\n"
        "新增王 王名 分鐘\n"
        "例：新增王 黑龍1 720\n\n"

        "➕【批次新增】\n"
        "批次新增王 王A、王B、王C 分鐘\n"
        "例：批次新增王 黑龍1、白龍1 720\n\n"

        "✏️【修改 BOSS】\n"
        "修改王 王名 分鐘\n"
        "例：修改王 黑龍1 1440\n\n"

        "🗑️【刪除 BOSS】\n"
        "刪除王 王名\n"
        "例：刪除王 黑龍1\n\n"

        "🔒【管理權限】\n"
        "執行以上指令後，Bot 會要求輸入管理密碼。\n"
        "請在 60 秒內完成驗證。\n"
        "密碼錯誤或逾時，本次操作會取消。\n\n"

        "⚠️【注意】\n"
        "新增王 / 修改王 / 刪除王\n"
        "會影響所有使用此 Bot 的 LINE 群組。"
    )


# =========================================================
# 首頁
# =========================================================

@app.route("/", methods=["GET"])
def home():

    return "BOSS LINE Bot 正常運作！"


# =========================================================
# Webhook
# =========================================================

@app.route(
    "/callback",
    methods=["POST"]
)
def callback():

    signature = request.headers.get(
        "X-Line-Signature"
    )

    body = request.get_data(
        as_text=True
    )

    try:

        handler.handle(
            body,
            signature
        )

    except InvalidSignatureError:

        abort(400)

    return "OK"


# =========================================================
# LINE 訊息
# =========================================================

@handler.add(
    MessageEvent,
    message=TextMessageContent
)
def handle_message(event):

    text = event.message.text.strip()

    chat_id = get_chat_id(event)

    reply_message = None

    # =====================================================
    # 管理員密碼驗證
    # 新增王 / 批次新增王 / 修改王 / 刪除王
    # =====================================================

    admin_verified = False

    # 如果目前聊天室正在等待密碼，這一則訊息就視為密碼
    if chat_id in PENDING_ADMIN_ACTIONS:

        pending = PENDING_ADMIN_ACTIONS[chat_id]

        # 超過 60 秒，自動取消
        if datetime.now(TZ) - pending["time"] > timedelta(seconds=60):

            del PENDING_ADMIN_ACTIONS[chat_id]

            with ApiClient(configuration) as api_client:
                line_bot_api = MessagingApi(api_client)
                line_bot_api.reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[
                            TextMessage(
                                text=(
                                    "⏰ 管理驗證已逾時。\n"
                                    "請重新輸入管理指令。"
                                )
                            )
                        ]
                    )
                )
            return

        # 密碼正確：恢復原本的管理指令，繼續往下執行
        elif text == ADMIN_PASSWORD:

            text = pending["command"]
            del PENDING_ADMIN_ACTIONS[chat_id]
            admin_verified = True

        # 密碼錯誤：取消此次操作
        else:

            del PENDING_ADMIN_ACTIONS[chat_id]

            with ApiClient(configuration) as api_client:
                line_bot_api = MessagingApi(api_client)
                line_bot_api.reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[
                            TextMessage(
                                text=(
                                    "❌ 管理密碼錯誤。\n"
                                    "此次操作已取消。"
                                )
                            )
                        ]
                    )
                )
            return

    # 管理指令第一次輸入時，先暫存並要求密碼
    is_admin_command = (
        text.startswith("新增王 ")
        or text.startswith("批次新增王 ")
        or text.startswith("修改王 ")
        or text.startswith("刪除王 ")
    )

    if is_admin_command and not admin_verified:

        PENDING_ADMIN_ACTIONS[chat_id] = {
            "command": text,
            "time": datetime.now(TZ)
        }

        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[
                        TextMessage(
                            text=(
                                "🔒 此操作需要管理權限。\n"
                                "請在 60 秒內輸入管理密碼。"
                            )
                        )
                    ]
                )
            )
        return


    # =====================================================
    # 群組 ID
    # =====================================================

    if text in ["群組ID", "群組id", "GROUPID", "groupid"]:
        reply_message = TextMessage(
            text=(
                "🆔 目前聊天室 ID\n\n"
                f"{chat_id}"
            )
        )

    # =====================================================
    # 同步既有 BOSS Discord 提醒
    # =====================================================

    elif text == "同步提醒":
        success_count, failed_count = sync_existing_reminders(chat_id)

        if success_count == 0 and failed_count == 0:
            reply_message = TextMessage(
                text=(
                    "ℹ️ 目前沒有需要同步的 BOSS。\n"
                    "只會同步尚未到重生時間的 KB 紀錄。"
                )
            )
        else:
            result = (
                "🔄 Discord 提醒同步完成\n\n"
                f"✅ 成功：{success_count} 隻"
            )

            if failed_count:
                result += f"\n❌ 失敗：{failed_count} 隻"

            result += (
                "\n\n之後會依原本的重生時間，"
                "在 5 分鐘 / 1 分鐘前提醒。"
            )

            reply_message = TextMessage(text=result)

    # =====================================================
    # HALF
    # =====================================================

    elif text.upper() == "HALF":

        enabled = toggle_half_mode(chat_id)

        if enabled:

            reply_message = TextMessage(
                text=(
                    "⚡ HALF 減半模式：已開啟\n\n"
                    "目前群組之後新 K 的 BOSS，"
                    "重生週期全部減半。\n\n"
                    "720 → 360 分鐘\n"
                    "1440 → 720 分鐘\n"
                    "2880 → 1440 分鐘"
                )
            )

        else:

            reply_message = TextMessage(
                text=(
                    "⏱️ HALF 減半模式：已關閉\n\n"
                    "目前群組已恢復正常重生週期。"
                )
            )


    elif text.upper() == "HALF ON":

        set_half_mode(
            chat_id,
            True
        )

        reply_message = TextMessage(
            text=(
                "⚡ HALF 減半模式：已開啟\n\n"
                "目前群組之後新 K 的 BOSS，"
                "重生週期全部減半。\n\n"
                "720 → 360 分鐘\n"
                "1440 → 720 分鐘\n"
                "2880 → 1440 分鐘"
            )
        )


    elif text.upper() == "HALF OFF":

        set_half_mode(
            chat_id,
            False
        )

        reply_message = TextMessage(
            text=(
                "⏱️ HALF 減半模式：已關閉\n\n"
                "目前群組已恢復正常重生週期。"
            )
        )


    # =====================================================
    # RESTART
    # =====================================================

    elif text.upper() == "RESTART":

        deleted_count = restart_bosses(chat_id)

        reply_message = TextMessage(
            text=(
                "🔄 RESTART 完成\n"
                "已清除目前聊天室全部死亡紀錄。\n"
                f"共清除 {deleted_count} 筆紀錄。\n\n"
                "HALF 設定不受影響。"
            )
        )


    # =====================================================
    # KB
    # =====================================================

    elif text.upper() == "KB":

        reply_message = create_kb_table(chat_id)


    # =====================================================
    # 批次新增王
    # =====================================================

    elif text.startswith("批次新增王 "):

        content = text[
            len("批次新增王 "):
        ].strip()

        try:

            boss_text, minutes_text = content.rsplit(
                None,
                1
            )

            minutes = int(minutes_text)

            if minutes <= 0:
                raise ValueError

        except (
            ValueError,
            IndexError
        ):

            reply_message = TextMessage(
                text=(
                    "❌ 批次新增格式錯誤\n\n"
                    "正確格式：\n"
                    "批次新增王 王A1、王B1、王C1 720\n\n"
                    "最後面的數字是重生週期（分鐘）。"
                )
            )

        else:

            boss_text = (
                boss_text
                .replace("，", "、")
                .replace(",", "、")
            )

            boss_names = [
                name.strip()
                for name in boss_text.split("、")
                if name.strip()
            ]

            if not boss_names:

                reply_message = TextMessage(
                    text="❌ 沒有找到 BOSS 名稱。"
                )

            else:

                success_list = []
                exists_list = []

                for boss_name in boss_names:

                    success, message = add_boss(
                        boss_name,
                        minutes
                    )

                    if success:
                        success_list.append(boss_name)
                    else:
                        exists_list.append(boss_name)

                result = (
                    "✅ 批次新增完成\n\n"
                    f"週期：{minutes:,} 分鐘\n"
                    f"成功新增：{len(success_list)} 隻\n"
                )

                if success_list:

                    result += (
                        "\n【新增成功】\n"
                        + "、".join(success_list)
                    )

                if exists_list:

                    result += (
                        "\n\n【已存在／跳過】\n"
                        + "、".join(exists_list)
                    )

                reply_message = TextMessage(
                    text=result
                )


    # =====================================================
    # 新增王
    # =====================================================

    elif text.startswith("新增王 "):

        parts = text.split()

        if len(parts) != 3:

            reply_message = TextMessage(
                text=(
                    "❌ 格式錯誤\n\n"
                    "新增王 BOSS名稱+線路 重生分鐘\n\n"
                    "例如：新增王 黑龍1 720"
                )
            )

        else:

            boss_name = parts[1]

            try:

                minutes = int(parts[2])

                if minutes <= 0:
                    raise ValueError

                success, message = add_boss(
                    boss_name,
                    minutes
                )

                if success:

                    reply_message = TextMessage(
                        text=(
                            "✅ 新增 BOSS 成功\n\n"
                            f"名稱：{boss_name}\n"
                            f"週期：{minutes:,} 分鐘"
                        )
                    )

                else:

                    reply_message = TextMessage(
                        text=(
                            f"❌ {message}\n"
                            "如果要改週期，請使用「修改王」。"
                        )
                    )

            except ValueError:

                reply_message = TextMessage(
                    text=(
                        "❌ 週期必須是分鐘數。\n\n"
                        "例如：新增王 黑龍1 720"
                    )
                )


    # =====================================================
    # 修改王
    # =====================================================

    elif text.startswith("修改王 "):

        parts = text.split()

        if len(parts) != 3:

            reply_message = TextMessage(
                text=(
                    "❌ 格式錯誤\n"
                    "例如：修改王 黑龍1 1440"
                )
            )

        else:

            boss_name = parts[1]

            try:

                minutes = int(parts[2])

                if minutes <= 0:
                    raise ValueError

                success, result = edit_boss(
                    boss_name,
                    minutes
                )

                if success:

                    reply_message = TextMessage(
                        text=(
                            "✏️ 修改 BOSS 成功\n\n"
                            f"名稱：{result}\n"
                            f"新週期：{minutes:,} 分鐘\n\n"
                            "※ 已記錄的舊重生時間不會改變，"
                            "下次重新 K 王時會套用新週期。"
                        )
                    )

                else:

                    reply_message = TextMessage(
                        text="❌ 找不到這隻王。"
                    )

            except ValueError:

                reply_message = TextMessage(
                    text=(
                        "❌ 週期必須是分鐘數。\n"
                        "例如：修改王 黑龍1 1440"
                    )
                )


    # =====================================================
    # 刪除王
    # =====================================================

    elif text.startswith("刪除王 "):

        # 直接取得「刪除王」後面的完整 BOSS 名稱，
        # 避免密碼驗證後重新處理指令時因空白造成格式判斷錯誤。
        boss_name = text[len("刪除王 "):].strip()

        if not boss_name:

            reply_message = TextMessage(
                text=(
                    "❌ 格式錯誤\n"
                    "例如：刪除王 黑龍1"
                )
            )

        else:

            success, real_name = delete_boss(
                boss_name
            )

            if success:

                reply_message = TextMessage(
                    text=(
                        "🗑️ 已刪除 BOSS\n"
                        f"{real_name}"
                    )
                )

            else:

                reply_message = TextMessage(
                    text="❌ 找不到這隻王。"
                )


    # =====================================================
    # 取消單隻 BOSS 紀錄
    # =====================================================

    elif text.startswith("取消 "):
        boss_name = text[len("取消 "):].strip()

        if not boss_name:
            reply_message = TextMessage(
                text="❌ 格式錯誤\n請輸入：取消 王名\n例如：取消 大象H"
            )
        else:
            success, real_name, error = cancel_boss_record(chat_id, boss_name)

            if success:
                reply_message = TextMessage(
                    text=(
                        "↩️ 已取消 BOSS 紀錄\n"
                        f"{real_name}\n\n"
                        "※ 只取消目前群組的紀錄，固定王表不受影響。"
                    )
                )
            elif error == "boss_not_found":
                reply_message = TextMessage(
                    text=(
                        f"❌ 找不到 BOSS：{boss_name}\n"
                        "輸入「王列表」查看完整名單。"
                    )
                )
            else:
                reply_message = TextMessage(
                    text=f"ℹ️ {real_name} 目前沒有 K 王紀錄，不需要取消。"
                )


    # =====================================================
    # K 王
    # =====================================================

    elif text.upper().startswith("K "):

        parts = text.split()


        # 現在時間
        if len(parts) == 2:

            input_name = parts[1]

            boss_name, minutes = find_boss(
                input_name
            )

            if boss_name is None:

                reply_message = TextMessage(
                    text=(
                        f"❌ 找不到 BOSS：{input_name}\n\n"
                        "輸入「王列表」查看完整名單。"
                    )
                )

            else:

                (
                    kill_time,
                    respawn_time,
                    actual_minutes,
                    half_mode
                ) = record_kill(
                    chat_id,
                    boss_name,
                    minutes
                )

                reply_message = create_kill_card(
                    boss_name,
                    kill_time,
                    respawn_time,
                    actual_minutes,
                    manual=False,
                    half_mode=half_mode
                )


        # 手動補登
        elif len(parts) == 3:

            input_name = parts[1]
            time_text = parts[2]

            boss_name, minutes = find_boss(
                input_name
            )

            if boss_name is None:

                reply_message = TextMessage(
                    text=(
                        f"❌ 找不到 BOSS：{input_name}\n\n"
                        "輸入「王列表」查看完整名單。"
                    )
                )

            else:

                manual_time = parse_manual_time(
                    time_text
                )

                if manual_time is None:

                    reply_message = TextMessage(
                        text=(
                            "❌ 時間格式錯誤\n\n"
"請輸入 4 碼或 6 碼時間。\n"
"例如：\n"
"K 大象H 1022 → 今天 10:22:00\n"
"K 大象H 102233 → 今天 10:22:33"
                        )
                    )

                else:

                    (
                        kill_time,
                        respawn_time,
                        actual_minutes,
                        half_mode
                    ) = record_kill(
                        chat_id,
                        boss_name,
                        minutes,
                        kill_time=manual_time
                    )

                    reply_message = create_kill_card(
                        boss_name,
                        kill_time,
                        respawn_time,
                        actual_minutes,
                        manual=True,
                        half_mode=half_mode
                    )

        else:

            reply_message = TextMessage(
    text=(
        "❌ K 王格式錯誤\n\n"
        "現在時間：K 大象H\n"
        "時分補登：K 大象H 1022\n"
        "時分秒補登：K 大象H 102233"
    )
)


    # =====================================================
    # 王列表
    # =====================================================

    elif text in [
        "王列表",
        "boss列表",
        "BOSS列表"
    ]:

        reply_message = TextMessage(
            text=get_boss_names()
        )


    # =====================================================
    # 王
    # =====================================================

    elif text in [
        "王",
        "BOSS",
        "boss",
        "Boss"
    ]:

        reply_message = TextMessage(
            text=get_boss_list(chat_id)
        )


    # =====================================================
    # 管理指令
    # =====================================================

    elif text == "管理指令":

        reply_message = TextMessage(
            text=get_admin_help()
        )


    # =====================================================
    # 指令
    # =====================================================

    elif text in [
        "指令",
        "HELP",
        "help",
        "Help"
    ]:

        reply_message = TextMessage(
            text=get_help()
        )


    # =====================================================
    # 測試
    # =====================================================

    elif text in [
        "測試",
        "test",
        "TEST"
    ]:

        half_mode = get_half_mode(chat_id)

        if half_mode:
            mode_text = "⚡ HALF 減半模式"
        else:
            mode_text = "⏱️ 正常模式"

        reply_message = TextMessage(
            text=(
                "✅ BOSS Bot 正常運作！\n"
                f"目前：{mode_text}\n"
                "資料庫：PostgreSQL"
            )
        )


    # =====================================================
    # 回覆 LINE
    # =====================================================

    if reply_message:

        with ApiClient(
            configuration
        ) as api_client:

            line_bot_api = MessagingApi(
                api_client
            )

            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[
                        reply_message
                    ]
                )
            )



# =========================================================
# Discord KB 查詢
# Discord 只提供 KB；資料來源固定對應 LINE 群組
# =========================================================

def create_discord_kb_embeds(chat_id):
    bosses = get_current_bosses(chat_id)

    if not bosses:
        return []

    date_groups = {}
    for item in bosses:
        respawn = item["respawn_time"].astimezone(TZ)
        date_key = respawn.strftime("%Y-%m-%d")
        date_groups.setdefault(date_key, []).append(item)

    embeds = []
    current_lines = []
    current_count = 0

    def flush_embed():
        nonlocal current_lines, current_count
        if not current_lines:
            return

        embed = discord.Embed(
            title="📋 BOSS 重生時間表",
            description="\n".join(current_lines),
        )
        embed.set_footer(text="時區：Asia/Taipei｜資料來源：LINE 群組")
        embeds.append(embed)
        current_lines = []
        current_count = 0

    for date_key in sorted(date_groups.keys()):
        items = date_groups[date_key]
        sample_date = items[0]["respawn_time"].astimezone(TZ)
        header = f"**📅 {sample_date.strftime('%m/%d')} 週{weekday_tw(sample_date)}**"

        # 每張 Embed 控制在約 20 隻，避免 Discord 內容上限。
        if current_count and current_count + len(items) > 20:
            flush_embed()

        current_lines.append(header)
        for item in items:
            respawn = item["respawn_time"].astimezone(TZ)
            current_lines.append(
                f"`{respawn.strftime('%H:%M:%S')}`  **{item['boss_name']}**"
            )
            current_count += 1
        current_lines.append("")

    flush_embed()

    total = len(embeds)
    if total > 1:
        for index, embed in enumerate(embeds, start=1):
            embed.set_footer(
                text=f"時區：Asia/Taipei｜資料來源：LINE 群組｜{index}/{total}"
            )

    return embeds


class BossDiscordClient(discord.Client):
    async def on_ready(self):
        print(f"[DISCORD] READY: logged in as {self.user} (id={self.user.id})", flush=True)

    async def on_message(self, message):
        if message.author.bot:
            return

        if message.content.strip().upper() != "KB":
            return

        if not DISCORD_KB_LINE_CHAT_ID:
            await message.channel.send("❌ DISCORD_KB_LINE_CHAT_ID 尚未設定。")
            return

        try:
            embeds = create_discord_kb_embeds(DISCORD_KB_LINE_CHAT_ID)

            if not embeds:
                await message.channel.send("📋 目前沒有 BOSS 紀錄。")
                return

            for embed in embeds:
                await message.channel.send(embed=embed)

        except Exception as exc:
            print(f"[DISCORD] KB ERROR: {type(exc).__name__}: {exc}", flush=True)
            await message.channel.send("❌ KB 查詢失敗，請稍後再試。")


def run_discord_bot():
    print("[DISCORD] Background thread entered.", flush=True)

    if not DISCORD_BOT_TOKEN:
        print("[DISCORD] ERROR: DISCORD_BOT_TOKEN is missing.", flush=True)
        return

    print(
        f"[DISCORD] Token found (length={len(DISCORD_BOT_TOKEN)}). Preparing client...",
        flush=True,
    )

    intents = discord.Intents.default()
    intents.message_content = True
    client = BossDiscordClient(intents=intents)

    try:
        print("[DISCORD] Connecting to Discord Gateway...", flush=True)
        asyncio.run(client.start(DISCORD_BOT_TOKEN))
    except discord.LoginFailure:
        print(
            "[DISCORD] ERROR: Discord rejected the bot token (LoginFailure). "
            "Reset the token in Discord Developer Portal and update DISCORD_BOT_TOKEN in Render.",
            flush=True,
        )
    except discord.PrivilegedIntentsRequired:
        print(
            "[DISCORD] ERROR: Message Content Intent is not enabled for this bot.",
            flush=True,
        )
    except Exception as exc:
        print(
            f"[DISCORD] ERROR: {type(exc).__name__}: {exc}",
            flush=True,
        )


def start_discord_bot():
    print("[DISCORD] start_discord_bot() called.", flush=True)

    if not DISCORD_BOT_TOKEN:
        print("[DISCORD] ERROR: DISCORD_BOT_TOKEN is missing; bot will not start.", flush=True)
        return

    thread = threading.Thread(
        target=run_discord_bot,
        name="discord-bot",
        daemon=True,
    )
    thread.start()
    print("[DISCORD] Background thread started.", flush=True)


start_discord_bot()



# =========================================================
# 啟動
# =========================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    app.run(
        host="0.0.0.0",
        port=port
    )
