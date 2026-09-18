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
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent


app = Flask(__name__)

# LINE 金鑰從 Render 環境變數取得
CHANNEL_ACCESS_TOKEN = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
CHANNEL_SECRET = os.environ["LINE_CHANNEL_SECRET"]

configuration = Configuration(access_token=CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)

# 台灣時間
TZ = ZoneInfo("Asia/Taipei")

# 資料庫
DB_PATH = "boss.db"


# =========================================================
# BOSS 設定
# respawn 單位：分鐘
# 之後我們再把你的真正 BOSS 名單加進來
# =========================================================

BOSSES = {
    "巴風特": {
        "name": "巴風特",
        "respawn": 240,
    },
    "黃金蟲": {
        "name": "黃金蟲",
        "respawn": 120,
    },
    "蟻后": {
        "name": "蟻后",
        "respawn": 180,
    },
}


# =========================================================
# 建立資料庫
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


def get_chat_id(event):
    source = event.source

    if getattr(source, "group_id", None):
        return source.group_id

    if getattr(source, "room_id", None):
        return source.room_id

    if getattr(source, "user_id", None):
        return source.user_id

    return "unknown"


def format_time(dt):
    return dt.astimezone(TZ).strftime("%m/%d %H:%M")


def remaining_text(respawn):
    now = datetime.now(TZ)

    if respawn <= now:
        return "已可重生 🔥"

    diff = respawn - now
    minutes = int(diff.total_seconds() // 60)

    hours = minutes // 60
    mins = minutes % 60

    if hours:
        return f"{hours} 小時 {mins} 分鐘"

    return f"{mins} 分鐘"


def find_boss(name):
    name = name.strip().lower()

    for key, boss in BOSSES.items():
        if name == key.lower() or name == boss["name"].lower():
            return key, boss

    return None, None


def record_kill(chat_id, boss_key, boss):
    kill_time = datetime.now(TZ)

    respawn_time = kill_time + timedelta(
        minutes=boss["respawn"]
    )

    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        INSERT INTO boss_kills
        (chat_id, boss_key, boss_name, kill_time, respawn_time)
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(chat_id, boss_key)
        DO UPDATE SET
            boss_name = excluded.boss_name,
            kill_time = excluded.kill_time,
            respawn_time = excluded.respawn_time
    """, (
        chat_id,
        boss_key,
        boss["name"],
        kill_time.isoformat(),
        respawn_time.isoformat(),
    ))

    conn.commit()
    conn.close()

    return kill_time, respawn_time


def get_boss_list(chat_id):
    conn = sqlite3.connect(DB_PATH)

    rows = conn.execute("""
        SELECT boss_name, respawn_time
        FROM boss_kills
        WHERE chat_id = ?
        ORDER BY respawn_time ASC
    """, (chat_id,)).fetchall()

    conn.close()

    if not rows:
        return "目前沒有 BOSS 紀錄。\n輸入：K 巴風特"

    result = "👑 BOSS 重生時間\n\n"

    for boss_name, respawn_string in rows:
        respawn = datetime.fromisoformat(respawn_string)

        result += (
            f"⚔️ {boss_name}\n"
            f"重生：{format_time(respawn)}\n"
            f"剩餘：{remaining_text(respawn)}\n\n"
        )

    return result.strip()


@app.route("/", methods=["GET"])
def home():
    return "BOSS LINE Bot 正常運作！"


@app.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature")
    body = request.get_data(as_text=True)

    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)

    return "OK"


@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    text = event.message.text.strip()
    chat_id = get_chat_id(event)

    reply = None

    # K 巴風特
    if text.upper().startswith("K "):
        boss_name = text[2:].strip()
        boss_key, boss = find_boss(boss_name)

        if boss is None:
            reply = (
                f"❌ 找不到 BOSS：{boss_name}\n"
                "目前測試可使用：巴風特、黃金蟲、蟻后"
            )
        else:
            kill_time, respawn_time = record_kill(
                chat_id,
                boss_key,
                boss,
            )

            reply = (
                f"⚔️ {boss['name']} 已擊殺\n\n"
                f"🕐 擊殺：{format_time(kill_time)}\n"
                f"👑 重生：{format_time(respawn_time)}\n"
                f"⏳ 剩餘：{remaining_text(respawn_time)}"
            )

    # 查看所有王
    elif text in ["王", "BOSS", "boss", "Boss"]:
        reply = get_boss_list(chat_id)

    # 測試機器人
    elif text in ["測試", "test", "TEST"]:
        reply = "✅ BOSS Bot 正常運作！"

    if reply:
        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)

            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[TextMessage(text=reply)],
                )
            )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
    )
