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
# 預設 BOSS
# =========================================================

DEFAULT_BOSSES = {

    # 12 小時
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

    # 24 小時
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

    # 48 小時
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

    # BOSS 種類
    conn.execute("""
        CREATE TABLE IF NOT EXISTS boss_types (
            boss_key TEXT PRIMARY KEY,
            boss_name TEXT NOT NULL,
            minutes INTEGER NOT NULL
        )
    """)

    # BOSS 死亡紀錄
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

    # 每個群組 / 聊天室自己的 HALF 狀態
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_settings (
            chat_id TEXT PRIMARY KEY,
            half_mode INTEGER NOT NULL DEFAULT 0
        )
    """)

    # 預設 BOSS
    for boss_name, minutes in DEFAULT_BOSSES.items():

        conn.execute("""
            INSERT OR IGNORE INTO boss_types (
                boss_key,
                boss_name,
                minutes
            )
            VALUES (?, ?, ?)
        """, (
            boss_name.lower(),
            boss_name,
            minutes
        ))

    conn.commit()
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
# HALF 狀態
# 每個群組 / 聊天室獨立
# =========================================================

def get_half_mode(chat_id):

    conn = sqlite3.connect(DB_PATH)

    row = conn.execute("""
        SELECT half_mode
        FROM chat_settings
        WHERE chat_id = ?
    """, (chat_id,)).fetchone()

    conn.close()

    if row:
        return bool(row[0])

    # 沒設定過 = 預設關閉
    return False


def set_half_mode(chat_id, enabled):

    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        INSERT INTO chat_settings (
            chat_id,
            half_mode
        )
        VALUES (?, ?)

        ON CONFLICT(chat_id)
        DO UPDATE SET
            half_mode = excluded.half_mode
    """, (
        chat_id,
        1 if enabled else 0
    ))

    conn.commit()
    conn.close()


def toggle_half_mode(chat_id):

    current = get_half_mode(chat_id)

    new_value = not current

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

    conn = sqlite3.connect(DB_PATH)

    row = conn.execute("""
        SELECT boss_name, minutes
        FROM boss_types
        WHERE boss_key = ?
    """, (boss_key,)).fetchone()

    conn.close()

    if row:
        return row[0], row[1]

    return None, None


# =========================================================
# 新增王
# =========================================================

def add_boss(boss_name, minutes):

    boss_name = boss_name.strip()
    boss_key = boss_name.lower()

    conn = sqlite3.connect(DB_PATH)

    exists = conn.execute("""
        SELECT 1
        FROM boss_types
        WHERE boss_key = ?
    """, (boss_key,)).fetchone()

    if exists:

        conn.close()

        return False, "這隻王已經存在。"

    conn.execute("""
        INSERT INTO boss_types (
            boss_key,
            boss_name,
            minutes
        )
        VALUES (?, ?, ?)
    """, (
        boss_key,
        boss_name,
        minutes
    ))

    conn.commit()
    conn.close()

    return True, "新增成功"


# =========================================================
# 修改王
# =========================================================

def edit_boss(boss_name, minutes):

    boss_key = boss_name.strip().lower()

    conn = sqlite3.connect(DB_PATH)

    row = conn.execute("""
        SELECT boss_name
        FROM boss_types
        WHERE boss_key = ?
    """, (boss_key,)).fetchone()

    if not row:

        conn.close()

        return False, "找不到這隻王。"

    real_name = row[0]

    conn.execute("""
        UPDATE boss_types
        SET minutes = ?
        WHERE boss_key = ?
    """, (
        minutes,
        boss_key
    ))

    conn.commit()
    conn.close()

    return True, real_name


# =========================================================
# 刪除王
# =========================================================

def delete_boss(boss_name):

    boss_key = boss_name.strip().lower()

    conn = sqlite3.connect(DB_PATH)

    row = conn.execute("""
        SELECT boss_name
        FROM boss_types
        WHERE boss_key = ?
    """, (boss_key,)).fetchone()

    if not row:

        conn.close()

        return False, None

    real_name = row[0]

    conn.execute("""
        DELETE FROM boss_types
        WHERE boss_key = ?
    """, (boss_key,))

    conn.execute("""
        DELETE FROM boss_kills
        WHERE boss_key = ?
    """, (boss_key,))

    conn.commit()
    conn.close()

    return True, real_name


# =========================================================
# 手動死亡時間
#
# 1022 = 今天 10:22
# =========================================================

def parse_manual_time(time_text):

    time_text = time_text.strip()

    if len(time_text) != 4:
        return None

    if not time_text.isdigit():
        return None

    hour = int(time_text[:2])
    minute = int(time_text[2:])

    if hour < 0 or hour > 23:
        return None

    if minute < 0 or minute > 59:
        return None

    now = datetime.now(TZ)

    return now.replace(
        hour=hour,
        minute=minute,
        second=0,
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

    # -----------------------------------------------------
    # HALF
    # 只有目前聊天室 / 群組開啟時才減半
    # -----------------------------------------------------

    half_mode = get_half_mode(chat_id)

    if half_mode:
        actual_minutes = minutes / 2
    else:
        actual_minutes = minutes

    respawn_time = (
        kill_time
        + timedelta(minutes=actual_minutes)
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

    return (
        kill_time,
        respawn_time,
        actual_minutes,
        half_mode
    )


# =========================================================
# RESTART
# 只清除目前聊天室死亡紀錄
# 不會改 HALF 狀態
# =========================================================

def restart_bosses(chat_id):

    conn = sqlite3.connect(DB_PATH)

    cursor = conn.execute("""
        DELETE FROM boss_kills
        WHERE chat_id = ?
    """, (chat_id,))

    deleted_count = cursor.rowcount

    conn.commit()
    conn.close()

    return deleted_count


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

    # 避免顯示 360.0
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
                            "text": kill_time.strftime(
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
                            "text": respawn_time.strftime(
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
                                    "text": (
                                        f"{minutes_text} 分鐘"
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
        contents=FlexContainer.from_dict(
            bubble
        )
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

    for (
        boss_name,
        kill_string,
        respawn_string
    ) in rows:

        result.append({

            "boss_name": boss_name,

            "kill_time":
                datetime.fromisoformat(
                    kill_string
                ),

            "respawn_time":
                datetime.fromisoformat(
                    respawn_string
                )
        })

    return result


# =========================================================
# KB 王表
# =========================================================

def create_kb_table(chat_id):

    bosses = get_current_bosses(
        chat_id
    )

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

        respawn = (
            item["respawn_time"]
            .astimezone(TZ)
        )

        date_key = respawn.strftime(
            "%Y-%m-%d"
        )

        if date_key not in date_groups:
            date_groups[date_key] = []

        date_groups[date_key].append(
            item
        )

    all_dates = sorted(
        date_groups.keys()
    )

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

        items = date_groups[
            date_key
        ]

        sample_date = (
            items[0]["respawn_time"]
            .astimezone(TZ)
        )

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

        needed_rows = (
            len(items) + 1
        )

        if (
            current_contents
            and current_rows + needed_rows > 13
        ):

            add_card(
                current_contents
            )

            current_contents = []
            current_rows = 0

        current_contents.append(
            date_header
        )

        current_rows += 1

        for item in items:

            respawn = (
                item["respawn_time"]
                .astimezone(TZ)
            )

            row = {

                "type": "box",
                "layout": "horizontal",
                "margin": "sm",
                "spacing": "sm",
                "alignItems": "center",

                "contents": [

                    {
                        "type": "text",
                        "text": respawn.strftime(
                            "%H:%M:%S"
                        ),
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
                                "text": item[
                                    "boss_name"
                                ],
                                "size": "xs",
                                "weight": "bold",
                                "color": "#2563C5"
                            }
                        ]
                    }
                ]
            }

            current_contents.append(
                row
            )

            current_rows += 1

    add_card(
        current_contents
    )

    total_cards = len(cards)

    for index, card in enumerate(cards):

        card[
            "footer"
        ][
            "contents"
        ][1][
            "text"
        ] = (
            f"{index + 1}/{total_cards}"
        )

    carousel = {
        "type": "carousel",
        "contents": cards
    }

    return FlexMessage(
        alt_text="BOSS 重生時間表",
        contents=FlexContainer.from_dict(
            carousel
        )
    )


# =========================================================
# 王
# =========================================================

def get_boss_list(chat_id):

    bosses = get_current_bosses(
        chat_id
    )

    if not bosses:

        return (
            "目前沒有 BOSS 紀錄。\n"
            "輸入：K 大象H"
        )

    result = (
        "👑 BOSS 重生時間\n\n"
    )

    now = datetime.now(TZ)

    for item in bosses:

        respawn = (
            item["respawn_time"]
            .astimezone(TZ)
        )

        if respawn <= now:

            remaining = (
                "🔥 已到重生時間"
            )

        else:

            diff = respawn - now

            total_minutes = int(
                diff.total_seconds() // 60
            )

            days = (
                total_minutes // 1440
            )

            hours = (
                total_minutes % 1440
            ) // 60

            minutes = (
                total_minutes % 60
            )

            parts = []

            if days:
                parts.append(
                    f"{days}天"
                )

            if hours:
                parts.append(
                    f"{hours}小時"
                )

            if minutes:
                parts.append(
                    f"{minutes}分"
                )

            remaining = (
                " ".join(parts)
            )

        result += (
            f"⚔️ {item['boss_name']}\n"
            f"🕐 {respawn.strftime('%m/%d %H:%M:%S')}\n"
            f"⏳ {remaining}\n\n"
        )

    return result.strip()


# =========================================================
# 王列表
#
# H 結尾 = H線
# 1 結尾 = 1線
# 其他 = 其他
# =========================================================

def get_boss_names():

    conn = sqlite3.connect(
        DB_PATH
    )

    rows = conn.execute("""
        SELECT boss_name, minutes
        FROM boss_types
        ORDER BY minutes ASC, boss_name ASC
    """).fetchall()

    conn.close()

    lines = {
        "H線": {},
        "1線": {},
        "其他": {}
    }

    for boss_name, minutes in rows:

        upper_name = boss_name.upper()

        if upper_name.endswith("H"):

            line_name = "H線"

        elif boss_name.endswith("1"):

            line_name = "1線"

        else:

            line_name = "其他"

        if minutes not in lines[
            line_name
        ]:

            lines[
                line_name
            ][minutes] = []

        lines[
            line_name
        ][minutes].append(
            boss_name
        )

    result = "📋 BOSS 名單\n"

    for line_name in [
        "H線",
        "1線",
        "其他"
    ]:

        groups = lines[
            line_name
        ]

        if not groups:
            continue

        result += (
            "\n━━━━━━━━━━\n"
            f"【{line_name}】\n"
            "━━━━━━━━━━\n"
        )

        for minutes in sorted(
            groups.keys()
        ):

            if minutes % 60 == 0:

                title = (
                    f"{minutes // 60}小時"
                )

            else:

                title = (
                    f"{minutes}分鐘"
                )

            result += (
                f"\n〔{title}〕\n"
            )

            boss_list = groups[
                minutes
            ]

            for i in range(
                0,
                len(boss_list),
                5
            ):

                result += (
                    "、".join(
                        boss_list[
                            i:i + 5
                        ]
                    )
                    + "\n"
                )

    return result.strip()


# =========================================================
# 指令說明
# =========================================================

def get_help():

    return (

        "📖 BOSS Bot 指令\n\n"

        "【記錄死亡】\n\n"

        "K BOSS名稱+線路\n"
        "→ BOSS名稱+線路 現在死亡\n\n"

        "K BOSS名稱+線路 時間\n"
        "→ BOSS名稱+線路 手動補登死亡時間\n\n"

        "例如：\n"
        "K 大象H\n"
        "→ 大象H 現在死亡\n\n"

        "K 大象H 1022\n"
        "→ 大象H 今天 10:22 死亡\n\n"


        "【查看】\n\n"

        "KB\n"
        "→ 顯示王表\n\n"

        "王\n"
        "→ 查看目前紀錄\n\n"

        "王列表\n"
        "→ 查看全部王\n\n"


        "【HALF 減半模式】\n\n"

        "HALF\n"
        "→ 切換目前群組正常 / 減半模式\n\n"

        "HALF ON\n"
        "→ 目前群組開啟減半模式\n\n"

        "HALF OFF\n"
        "→ 目前群組關閉減半模式\n\n"

        "※ HALF 開啟後，之後新 K 的 BOSS "
        "重生時間會減半。\n"
        "※ 不會修改已經記錄的舊重生時間。\n\n"


        "【新增 / 修改】\n\n"

        "新增王 BOSS名稱+線路 重生分鐘\n"
        "→ 新增一隻 BOSS\n\n"

        "修改王 BOSS名稱+線路 重生分鐘\n"
        "→ 修改 BOSS 重生時間\n\n"

        "刪除王 BOSS名稱+線路\n"
        "→ 刪除這隻 BOSS\n\n"

        "例如：\n"
        "新增王 黑龍1 720\n"
        "→ 新增黑龍1，12小時重生\n\n"

        "修改王 黑龍1 1440\n"
        "→ 黑龍1 改成24小時重生\n\n"

        "刪除王 黑龍1\n"
        "→ 刪除黑龍1\n\n"


        "【批次新增】\n\n"

        "批次新增王 "
        "BOSS名稱+線路、BOSS名稱+線路 "
        "重生分鐘\n"

        "→ 一次新增多隻相同重生時間的 BOSS\n\n"

        "例如：\n"

        "批次新增王 "
        "伐木1、倒塌1、山峰1 720\n"

        "→ 一次新增3隻1線 BOSS，12小時重生\n\n"


        "【重置】\n\n"

        "RESTART\n"
        "→ 清除目前聊天室全部死亡紀錄"
    )


# =========================================================
# 首頁
# =========================================================

@app.route("/", methods=["GET"])
def home():

    return (
        "BOSS LINE Bot 正常運作！"
    )


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

    chat_id = get_chat_id(
        event
    )

    reply_message = None


    # =====================================================
    # HALF
    # =====================================================

    if text.upper() == "HALF":

        enabled = toggle_half_mode(
            chat_id
        )

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


    # =====================================================
    # HALF ON
    # =====================================================

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


    # =====================================================
    # HALF OFF
    # =====================================================

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

        deleted_count = restart_bosses(
            chat_id
        )

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

        reply_message = create_kb_table(
            chat_id
        )


    # =====================================================
    # 批次新增王
    # =====================================================

    elif text.startswith(
        "批次新增王 "
    ):

        content = text[
            len("批次新增王 "):
        ].strip()

        try:

            boss_text, minutes_text = (
                content.rsplit(
                    None,
                    1
                )
            )

            minutes = int(
                minutes_text
            )

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
                .replace(
                    "，",
                    "、"
                )
                .replace(
                    ",",
                    "、"
                )
            )

            boss_names = [
                name.strip()
                for name
                in boss_text.split("、")
                if name.strip()
            ]

            if not boss_names:

                reply_message = TextMessage(
                    text=(
                        "❌ 沒有找到 BOSS 名稱。"
                    )
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

                        success_list.append(
                            boss_name
                        )

                    else:

                        exists_list.append(
                            boss_name
                        )

                result = (
                    "✅ 批次新增完成\n\n"
                    f"週期：{minutes:,} 分鐘\n"
                    f"成功新增：{len(success_list)} 隻\n"
                )

                if success_list:

                    result += (
                        "\n【新增成功】\n"
                        + "、".join(
                            success_list
                        )
                    )

                if exists_list:

                    result += (
                        "\n\n【已存在／跳過】\n"
                        + "、".join(
                            exists_list
                        )
                    )

                reply_message = TextMessage(
                    text=result
                )


    # =====================================================
    # 新增王
    # =====================================================

    elif text.startswith(
        "新增王 "
    ):

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

                minutes = int(
                    parts[2]
                )

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

    elif text.startswith(
        "修改王 "
    ):

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

                minutes = int(
                    parts[2]
                )

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
                        text=(
                            "❌ 找不到這隻王。"
                        )
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

    elif text.startswith(
        "刪除王 "
    ):

        parts = text.split()

        if len(parts) != 2:

            reply_message = TextMessage(
                text=(
                    "❌ 格式錯誤\n"
                    "例如：刪除王 黑龍1"
                )
            )

        else:

            success, real_name = delete_boss(
                parts[1]
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
                    text=(
                        "❌ 找不到這隻王。"
                    )
                )


    # =====================================================
    # K 王
    #
    # K 大象H
    # K 大象H 1022
    # =====================================================

    elif text.upper().startswith(
        "K "
    ):

        parts = text.split()


        # K 王 - 現在時間
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


        # K 王 1022 - 手動補登
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
                            "請輸入 4 碼時間。\n"
                            "例如：K 大象H 1022\n"
                            "代表今天 10:22。"
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
                    "手動補登：K 大象H 1022"
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
            text=get_boss_list(
                chat_id
            )
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

        half_mode = get_half_mode(
            chat_id
        )

        if half_mode:

            mode_text = (
                "⚡ HALF 減半模式"
            )

        else:

            mode_text = (
                "⏱️ 正常模式"
            )

        reply_message = TextMessage(
            text=(
                "✅ BOSS Bot 正常運作！\n"
                f"目前：{mode_text}"
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
