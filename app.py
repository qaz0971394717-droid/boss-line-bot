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

configuration = Configuration(
    access_token=CHANNEL_ACCESS_TOKEN
)

handler = WebhookHandler(CHANNEL_SECRET)

TZ = ZoneInfo("Asia/Taipei")
DB_PATH = "boss.db"


# =========================================================
# BOSS 名單
# 單位：分鐘
# =========================================================

BOSSES = {

    # ===== 720 分鐘 / 12 小時 =====
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

    # ===== 1440 分鐘 / 24 小時 =====
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

    # ===== 2880 分鐘 / 48 小時 =====
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
# 取得聊天室 ID
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
# 尋找 BOSS
# 不分大小寫
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

    respawn_time = kill_time + timedelta(
        minutes=minutes
    )

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
# Flex Message：擊殺完成卡片
# =========================================================

def create_kill_card(
    boss_name,
    kill_time,
    respawn_time,
    minutes
):

    kill_text = kill_time.strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    respawn_text = respawn_time.strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    period_text = f"{minutes:,} 分鐘"

    bubble = {
        "type": "bubble",

        "body": {
            "type": "box",
            "layout": "vertical",
            "paddingAll": "20px",

            "contents": [

                # 標題
                {
                    "type": "text",
                    "text": f"{boss_name} 已記錄",
                    "weight": "bold",
                    "size": "xl",
                    "color": "#53687E",
                    "wrap": True
                },

                # 分隔線
                {
                    "type": "separator",
                    "margin": "lg",
                    "color": "#E4E8EC"
                },

                # 死亡時間
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [
                        {
                            "type": "text",
                            "text": "死亡時間",
                            "size": "sm",
                            "color": "#53687E",
                            "weight": "bold"
                        },
                        {
                            "type": "text",
                            "text": kill_text,
                            "size": "md",
                            "color": "#333333",
                            "margin": "sm"
                        }
                    ]
                },

                # 下一次重生
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [
                        {
                            "type": "text",
                            "text": "下一次重生",
                            "size": "sm",
                            "color": "#53687E",
                            "weight": "bold"
                        },
                        {
                            "type": "text",
                            "text": respawn_text,
                            "size": "md",
                            "color": "#333333",
                            "margin": "sm",
                            "weight": "bold"
                        }
                    ]
                },

                # 週期
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [
                        {
                            "type": "text",
                            "text": "週期",
                            "size": "sm",
                            "color": "#53687E",
                            "weight": "bold"
                        },
                        {
                            "type": "text",
                            "text": period_text,
                            "size": "md",
                            "color": "#333333",
                            "margin": "sm"
                        }
                    ]
                },

                # 時區
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "xl",

                    "contents": [
                        {
                            "type": "text",
                            "text": "時區",
                            "size": "sm",
                            "color": "#53687E",
                            "weight": "bold"
                        },
                        {
                            "type": "text",
                            "text": "Asia/Taipei",
                            "size": "md",
                            "color": "#333333",
                            "margin": "sm"
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
# 剩餘時間
# =========================================================

def remaining_text(respawn):

    now = datetime.now(TZ)

    if respawn <= now:
        return "🔥 已到重生時間"

    diff = respawn - now

    total_minutes = int(
        diff.total_seconds() // 60
    )

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

    return " ".join(parts)


# =========================================================
# 查看目前 BOSS
# =========================================================

def get_boss_list(chat_id):

    conn = sqlite3.connect(DB_PATH)

    rows = conn.execute("""
        SELECT
            boss_name,
            respawn_time
        FROM boss_kills
        WHERE chat_id = ?
        ORDER BY respawn_time ASC
    """, (
        chat_id,
    )).fetchall()

    conn.close()

    if not rows:

        return (
            "👑 目前沒有 BOSS 紀錄\n\n"
            "輸入：K 大象H"
        )

    text = "👑 BOSS 重生時間\n"
    text += "━━━━━━━━━━━━\n\n"

    for boss_name, respawn_string in rows:

        respawn = datetime.fromisoformat(
            respawn_string
        )

        text += f"⚔️ {boss_name}\n"

        text += (
            f"🕐 {respawn.strftime('%m/%d %H:%M:%S')}\n"
        )

        text += (
            f"⏳ {remaining_text(respawn)}\n\n"
        )

    return text.strip()


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

    text = "📋 BOSS 名單\n\n"

    text += "【12小時】\n"
    text += "、".join(group_720)

    text += "\n\n【24小時】\n"
    text += "、".join(group_1440)

    text += "\n\n【48小時】\n"
    text += "、".join(group_2880)

    return text


# =========================================================
# 網站首頁
# =========================================================

@app.route("/", methods=["GET"])
def home():

    return "BOSS LINE Bot 正常運作！"


# =========================================================
# LINE Webhook
# =========================================================

@app.route("/callback", methods=["POST"])
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
# LINE 收到訊息
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
    # K 王
    # =====================================================

    if text.upper().startswith("K "):

        input_name = text[2:].strip()

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


    # =====================================================
    # 查看目前重生時間
    # =====================================================

    elif text in [
        "王",
        "boss",
        "BOSS",
        "Boss"
    ]:

        reply_message = TextMessage(
            text=get_boss_list(chat_id)
        )


    # =====================================================
    # 查看全部王
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
    # 測試
    # =====================================================

    elif text in [
        "測試",
        "test",
        "TEST"
    ]:

        reply_message = TextMessage(
            text="✅ BOSS Bot 正常運作！"
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
