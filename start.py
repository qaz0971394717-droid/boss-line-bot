import os
import sys
import time
import signal
import subprocess


def stop_process(process):
    if process.poll() is None:
        process.terminate()

        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def main():
    port = os.environ.get("PORT", "10000")

    print("🚀 正在啟動 LINE + Discord BOSS Bot...", flush=True)

    # LINE / Flask
    line_process = subprocess.Popen([
        "gunicorn",
        "app:app",
        "--bind",
        f"0.0.0.0:{port}"
    ])

    # Discord Bot
    discord_process = subprocess.Popen([
        sys.executable,
        "discord_bot.py"
    ])

    print("✅ LINE Bot 啟動程序已建立", flush=True)
    print("✅ Discord Bot 啟動程序已建立", flush=True)

    processes = [
        line_process,
        discord_process
    ]

    try:
        while True:
            for process in processes:
                code = process.poll()

                if code is not None:
                    print(
                        f"❌ 子程序停止，結束碼：{code}",
                        flush=True
                    )

                    for p in processes:
                        stop_process(p)

                    sys.exit(code if code != 0 else 1)

            time.sleep(2)

    except (KeyboardInterrupt, SystemExit):
        for process in processes:
            stop_process(process)


if __name__ == "__main__":
    main()
