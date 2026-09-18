import os
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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

configuration = Configuration(access_token=CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)

TZ = ZoneInfo("Asia/Taipei")
DB_PATH = "boss.db"


# =========================================================
# BOSS 名單
# 單位：分鐘
# =========================================================

BOSSES = {
    # 720 分鐘 / 12 小時
    "沼澤H": 720,
    "倒塌H": 720,
    "沙漠H": 720,
    "阿德H": 720,
    "生命H": 720,
    "掠奪H": 720,
    "廢墟H": 720,
    "激戰H": 720,
    "扭曲H": 720,
    "灰色H": 720,
    "743": 720,
    "z2": 720,
    "貝特H": 720,
    "時光H": 720,
    "伐木H": 720,
    "山峰H": 720,
    "歐奎H": 720,
    "涼風H": 720,
    "巨大H": 720,
    "雪怪H": 720,

    # 1440 分鐘 / 24 小時
    "大象H": 1440,
    "蠍子H": 1440,
    "火狗H": 1440,
    "745": 1440,
    "Z4": 1440,
    "貝努H": 1440,
    "公墓2": 1440,
    "公墓3": 1440,
    "公墓4": 1440,
    "船長H": 1440,
    "競技場H": 1440,

    # 2880 分鐘 / 48 小時
    "1GH": 2880,
    "2GH": 2880,
    "3GH": 2880,
    "5GH": 2880,
    "6GH": 2880,
    "7GH": 2880,
}


# =========================================================
# 資料庫
# =========================================================

def init_db():
    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS boss_kills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            boss_key TEXT NOT NULL,
            boss_name TEXT NOT NULL,
            kill_time TEXT NOT NULL,
            respawn_time TEXT NOT NULL,
            UNIQUE(chat_id, boss_key)
        )
    """)

    conn.commit()
    conn.close()


init_db()


# =========================================================
# 聊天室 ID
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
# 找 BOSS
# 不分英文大小寫
# =========================================================

def find_boss(input_name):
    input_name = input_name.strip().lower()

    for boss_name, minutes in BOSSES.items():
        if boss_name.lower() == input_name:
            return boss_name, minutes

    return None, None


# =========================================================
# 記錄擊殺
# =========================================================

def record_kill(chat_id, boss_name, minutes):
    kill_time = datetime.now(TZ)
    respawn_time = kill_time + timedelta(minutes=minutes)

    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        INSERT INTO boss_kills (
            chat_id,
            boss_key,
            boss_name,
            kill_time,
            respawn_time
        )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(chat_id, boss_key)
        DO UPDATE SET
            boss_name = excluded.boss_name,
            kill_time = excluded.kill_time,
            respawn_time = excluded.respawn_time
    """, (
        chat_id,
        boss_name.lower(),
        boss_name,
        kill_time.isoformat(),
        respawn_time.isoformat()
    ))

    conn.commit()
    conn.close()

    return kill_time, respawn_time


# =========================================================
# K 完後的記錄卡片
# =========================================================

def create_kill_card(boss_name, kill_time, respawn_time, minutes):
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
                    "backgroundColor": "#E5ECF5",
                    "cornerRadius": "8px",
                    "paddingAll": "12px",

                    "contents": [
                        {
                            "type": "text",
                            "text": f"{boss_name} 已記錄",
                            "weight": "bold",
                            "size": "xl",
                            "color": "#405B78"
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
                            "text": kill_time.strftime("%Y-%m-%d %H:%M:%S"),
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
                            "text": respawn_time.strftime("%Y-%m-%d %H:%M:%S"),
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
                                    "text": "週期",
                                    "size": "sm",
                                    "weight": "bold",
                                    "color": "#617A96"
                                },
                                {
                                    "type": "text",
                                    "text": f"{minutes:,} 分鐘",
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
                                    "text": "時區",
                                    "size": "sm",
                                    "weight": "bold",
                                    "color": "#617A96"
                                },
                                {
                                    "type": "text",
                                    "text": "Asia/Taipei",
                                    "size": "md",
                                    "margin": "sm",
                                    "color": "#222222"
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    }

    return FlexMessage(
        alt_text=f"{boss_name} 已記錄",
        contents=FlexContainer.from_dict(bubble)
    )


# =========================================================
# 星期
# =========================================================

def weekday_tw(dt):
    names = ["一", "二", "三", "四", "五", "六", "日"]
    return names[dt.weekday()]


# =========================================================
# 取得目前所有王
# =========================================================

def get_current_bosses(chat_id):
    conn = sqlite3.connect(DB_PATH)

    rows = conn.execute("""
        SELECT
            boss_name,
            kill_time,
            respawn_time
        FROM boss_kills
        WHERE chat_id = ?
        ORDER BY respawn_time ASC
    """, (chat_id,)).fetchall()

    conn.close()

    result = []

    for boss_name, kill_string, respawn_string in rows:
        kill_time = datetime.fromisoformat(kill_string)
        respawn_time = datetime.fromisoformat(respawn_string)

        result.append({
            "boss_name": boss_name,
            "kill_time": kill_time,
            "respawn_time": respawn_time
        })

    return result


# =========================================================
# 建立 KB 王表
# =========================================================

def create_kb_table(chat_id):
    bosses = get_current_bosses(chat_id)

    if not bosses:
        return TextMessage(
            text=(
                "目前沒有 BOSS 紀錄。\n\n"
                "請先輸入例如：K 大象H"
            )
        )

    # 按重生日期分組
    date_groups = {}

    for item in bosses:
        respawn = item["respawn_time"].astimezone(TZ)
        date_key = respawn.strftime("%Y-%m-%d")

        if date_key not in date_groups:
            date_groups[date_key] = []

        date_groups[date_key].append(item)

    # 每張卡片最多放幾個日期區塊
    # 這樣王很多時可以左右滑
    all_dates = sorted(date_groups.keys())

    cards = []
    current_contents = []
    current_rows = 0

    def add_card(contents):
        if not contents:
            return

        card_number = len(cards) + 1

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
                        "text": str(card_number),
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

        # 日期標題
        date_header = {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#E1E8F1",
            "cornerRadius": "5px",
            "paddingStart": "8px",
            "paddingEnd": "8px",
            "paddingTop": "5px",
            "paddingBottom": "5px",
            "margin": "sm" if current_contents else "none",

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

        # 一張卡片不要塞太多列
        if current_contents and current_rows + needed_rows > 13:
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

    # 補上 1/3、2/3 這種頁數
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
# 舊的「王」文字查詢
# =========================================================

def get_boss_list(chat_id):
    bosses = get_current_bosses(chat_id)

    if not bosses:
        return "目前沒有 BOSS 紀錄。\n輸入：K 大象H"

    result = "👑 BOSS 重生時間\n\n"

    now = datetime.now(TZ)

    for item in bosses:
        respawn = item["respawn_time"].astimezone(TZ)

        if respawn <= now:
            remaining = "🔥 已到重生時間"
        else:
            diff = respawn - now
            total_minutes = int(diff.total_seconds() // 60)

            days = total_minutes // 1440
            hours = (total_minutes % 1440) // 60
            minutes = total_minutes % 60

            parts = []

            if days:
                parts.append(f"{days}天")

            if hours:
                parts.append(f"{hours}小時")

            if minutes:
                parts.append(f"{minutes}分")

            remaining = " ".join(parts)

        result += (
            f"⚔️ {item['boss_name']}\n"
            f"🕐 {respawn.strftime('%m/%d %H:%M:%S')}\n"
            f"⏳ {remaining}\n\n"
        )

    return result.strip()


# =========================================================
# BOSS 名單
# =========================================================

def get_boss_names():
    group_720 = []
    group_1440 = []
    group_2880 = []

    for boss, minutes in BOSSES.items():
        if minutes == 720:
            group_720.append(boss)
        elif minutes == 1440:
            group_1440.append(boss)
        elif minutes == 2880:
            group_2880.append(boss)

    return (
        "📋 BOSS 名單\n\n"
        "【12小時】\n"
        + "、".join(group_720)
        + "\n\n【24小時】\n"
        + "、".join(group_1440)
        + "\n\n【48小時】\n"
        + "、".join(group_2880)
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

@app.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature")
    body = request.get_data(as_text=True)

    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)

    return "OK"


# =========================================================
# 收到 LINE 訊息
# =========================================================

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    text = event.message.text.strip()
    chat_id = get_chat_id(event)

    reply_message = None

    # -----------------------------------------------------
    # KB 王表
    # 必須放在 K 指令前面判斷
    # -----------------------------------------------------

    if text.upper() == "KB":
        reply_message = create_kb_table(chat_id)

    # -----------------------------------------------------
    # K 王名
    # 支援 K 大象H
    # -----------------------------------------------------

    elif text.upper().startswith("K "):
        input_name = text[2:].strip()

        boss_name, minutes = find_boss(input_name)

        if boss_name is None:
            reply_message = TextMessage(
                text=(
                    f"❌ 找不到 BOSS：{input_name}\n\n"
                    "輸入「王列表」查看完整名單。"
                )
            )

        else:
            kill_time, respawn_time = record_kill(
                chat_id,
                boss_name,
                minutes
            )

            reply_message = create_kill_card(
                boss_name,
                kill_time,
                respawn_time,
                minutes
            )

    # -----------------------------------------------------
    # 王
    # -----------------------------------------------------

    elif text in ["王", "BOSS", "boss", "Boss"]:
        reply_message = TextMessage(
            text=get_boss_list(chat_id)
        )

    # -----------------------------------------------------
    # 王列表
    # -----------------------------------------------------

    elif text in ["王列表", "boss列表", "BOSS列表"]:
        reply_message = TextMessage(
            text=get_boss_names()
        )

    # -----------------------------------------------------
    # 測試
    # -----------------------------------------------------

    elif text in ["測試", "test", "TEST"]:
        reply_message = TextMessage(
            text="✅ BOSS Bot 正常運作！"
        )

    # -----------------------------------------------------
    # 回覆
    # -----------------------------------------------------

    if reply_message:
        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)

            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[reply_message]
                )
            )


# =========================================================
# 啟動
# =========================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port
    )
