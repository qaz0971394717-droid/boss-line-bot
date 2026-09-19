import os
import discord

from app import (
    TZ,
    find_boss,
    parse_manual_time,
    record_kill,
    restart_bosses,
    get_current_bosses,
    get_boss_names,
    get_boss_list,
    get_half_mode,
    set_half_mode,
    toggle_half_mode,
    get_help,
)


DISCORD_BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]


# =========================================================
# Discord 設定
# =========================================================

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)


# =========================================================
# Discord 獨立聊天室 ID
# 每個 Discord 頻道的 K / KB / HALF 都獨立
# =========================================================

def get_discord_chat_id(message):

    if message.guild:
        return f"discord:{message.guild.id}:{message.channel.id}"

    return f"discord:dm:{message.author.id}"


# =========================================================
# 時間顯示
# =========================================================

def format_time(dt):

    return dt.astimezone(TZ).strftime(
        "%Y-%m-%d %H:%M:%S"
    )


# =========================================================
# K 完成卡片
# =========================================================

def create_discord_kill_embed(
    boss_name,
    kill_time,
    respawn_time,
    actual_minutes,
    manual,
    half_mode
):

    if manual:
        title = f"{boss_name} 已補登"
    else:
        title = f"{boss_name} 已記錄"

    if half_mode:
        mode_text = "⚡ HALF 減半"
        color = 0xF59E0B
    else:
        mode_text = "正常"
        color = 0x405B78

    if float(actual_minutes).is_integer():
        minutes_text = f"{int(actual_minutes):,}"
    else:
        minutes_text = f"{actual_minutes:g}"

    embed = discord.Embed(
        title=title,
        color=color
    )

    embed.add_field(
        name="死亡時間",
        value=format_time(kill_time),
        inline=False
    )

    embed.add_field(
        name="下一次重生",
        value=format_time(respawn_time),
        inline=False
    )

    embed.add_field(
        name="實際週期",
        value=f"{minutes_text} 分鐘",
        inline=True
    )

    embed.add_field(
        name="模式",
        value=mode_text,
        inline=True
    )

    embed.set_footer(
        text="時區：Asia/Taipei"
    )

    return embed


# =========================================================
# KB
# =========================================================

async def send_kb(message, chat_id):

    bosses = get_current_bosses(chat_id)

    if not bosses:

        await message.channel.send(
            "📋 目前沒有 BOSS 紀錄。\n\n"
            "現在記錄：`K 大象H`\n"
            "時分補登：`K 大象H 1022`\n"
            "時分秒補登：`K 大象H 102233`"
        )
        return

    # Discord Embed 最多 25 個 fields，
    # 所以每 20 隻王分一張。
    for start in range(0, len(bosses), 20):

        group = bosses[start:start + 20]

        embed = discord.Embed(
            title="📋 BOSS 重生表",
            color=0x405B78
        )

        for item in group:

            respawn = item["respawn_time"].astimezone(TZ)

            embed.add_field(
                name=item["boss_name"],
                value=respawn.strftime(
                    "%m/%d %H:%M:%S"
                ),
                inline=False
            )

        embed.set_footer(
            text="時區：Asia/Taipei"
        )

        await message.channel.send(
            embed=embed
        )


# =========================================================
# Discord 上線
# =========================================================

@client.event
async def on_ready():

    print(
        f"Discord Bot 已上線：{client.user}"
    )


# =========================================================
# Discord 訊息
# =========================================================

@client.event
async def on_message(message):

    # 不處理機器人自己的訊息
    if message.author.bot:
        return

    text = message.content.strip()

    if not text:
        return

    chat_id = get_discord_chat_id(message)


    # =====================================================
    # HALF
    # =====================================================

    if text.upper() == "HALF":

        enabled = toggle_half_mode(chat_id)

        if enabled:
            await message.channel.send(
                "⚡ HALF 減半模式已開啟\n"
                "之後新 K 的 BOSS 重生時間會減半。"
            )
        else:
            await message.channel.send(
                "⏱️ HALF 已關閉\n"
                "之後新 K 恢復正常重生時間。"
            )

        return


    if text.upper() == "HALF ON":

        set_half_mode(chat_id, True)

        await message.channel.send(
            "⚡ HALF 減半模式已開啟\n"
            "之後新 K 的 BOSS 重生時間會減半。"
        )

        return


    if text.upper() == "HALF OFF":

        set_half_mode(chat_id, False)

        await message.channel.send(
            "⏱️ HALF 已關閉\n"
            "之後新 K 恢復正常重生時間。"
        )

        return


    # =====================================================
    # RESTART
    # =====================================================

    if text.upper() == "RESTART":

        deleted_count = restart_bosses(chat_id)

        await message.channel.send(
            "♻️ 已清除目前 Discord 頻道的 "
            f"BOSS 紀錄，共 {deleted_count} 筆。\n"
            "HALF 設定不受影響。"
        )

        return


    # =====================================================
    # KB
    # =====================================================

    if text.upper() == "KB":

        await send_kb(
            message,
            chat_id
        )

        return


    # =====================================================
    # K 王
    # =====================================================

    if text.upper() == "K":

        await message.channel.send(
            "❌ K 王格式錯誤\n\n"
            "現在時間：`K 大象H`\n"
            "時分補登：`K 大象H 1022`\n"
            "時分秒補登：`K 大象H 102233`"
        )

        return


    if text.upper().startswith("K "):

        parts = text.split()

        if len(parts) not in (2, 3):

            await message.channel.send(
                "❌ K 王格式錯誤\n\n"
                "現在時間：`K 大象H`\n"
                "時分補登：`K 大象H 1022`\n"
                "時分秒補登：`K 大象H 102233`"
            )

            return

        input_name = parts[1]

        boss_name, minutes = find_boss(
            input_name
        )

        if not boss_name:

            await message.channel.send(
                f"❌ 找不到 BOSS：{input_name}\n"
                "請輸入 `王列表` 查看可用名稱。"
            )

            return

        manual = False
        manual_time = None

        if len(parts) == 3:

            manual = True

            manual_time = parse_manual_time(
                parts[2]
            )

            if manual_time is None:

                await message.channel.send(
                    "❌ 時間格式錯誤\n\n"
                    "請輸入 4 碼或 6 碼時間。\n"
                    "`K 大象H 1022` → 10:22:00\n"
                    "`K 大象H 102233` → 10:22:33"
                )

                return

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

        embed = create_discord_kill_embed(
            boss_name,
            kill_time,
            respawn_time,
            actual_minutes,
            manual,
            half_mode
        )

        await message.channel.send(
            embed=embed
        )

        return


    # =====================================================
    # 王列表
    # =====================================================

    if text in (
        "王列表",
        "boss列表",
        "BOSS列表"
    ):

        boss_text = get_boss_names()

        # Discord 單則訊息長度有限
        for start in range(
            0,
            len(boss_text),
            1900
        ):

            await message.channel.send(
                boss_text[
                    start:start + 1900
                ]
            )

        return


    # =====================================================
    # 王
    # =====================================================

    if text in (
        "王",
        "BOSS",
        "boss",
        "Boss"
    ):

        boss_text = get_boss_list(
            chat_id
        )

        for start in range(
            0,
            len(boss_text),
            1900
        ):

            await message.channel.send(
                boss_text[
                    start:start + 1900
                ]
            )

        return


    # =====================================================
    # 指令
    # =====================================================

    if text in (
        "指令",
        "HELP",
        "help",
        "Help"
    ):

        help_text = get_help()

        for start in range(
            0,
            len(help_text),
            1900
        ):

            await message.channel.send(
                help_text[
                    start:start + 1900
                ]
            )

        return


    # =====================================================
    # 測試
    # =====================================================

    if text in (
        "測試",
        "test",
        "TEST"
    ):

        half_mode = get_half_mode(
            chat_id
        )

        if half_mode:
            mode_text = "⚡ HALF 減半模式"
        else:
            mode_text = "⏱️ 正常模式"

        await message.channel.send(
            "✅ BOSS Bot Discord 正常運作！\n"
            f"目前：{mode_text}\n"
            "資料庫：PostgreSQL"
        )

        return


# =========================================================
# 啟動 Discord Bot
# =========================================================

client.run(DISCORD_BOT_TOKEN)
