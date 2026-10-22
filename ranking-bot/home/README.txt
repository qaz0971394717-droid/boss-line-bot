每日排行（家用電腦版）設定步驟（Windows）

1. 安裝 Node.js 22 或以上：https://nodejs.org （下載 LTS，一路下一步）
2. 把這個 ranking-bot 資料夾解壓縮到固定位置，例如 C:\ranking-bot
3. 進入 home 資料夾，把 .env.example 複製一份，改名為 .env（不是 .env.txt），
   用記事本打開，把「貼上 Channel access token」換成你的 LINE Channel access token。
4. 測試（只顯示、不推播）：打開 命令提示字元，輸入
     cd C:\ranking-bot
     node home\run.mjs --dry
   看到 TOP 10 清單代表你家網路抓得到；看到「今天抓不到」請把整段文字給我。
5. 測試推播：  node home\run.mjs   ，LINE 會收到訊息。
6. 設定每天 8:00 自動執行（命令提示字元，一行）：
     schtasks /Create /TN "DailyRanking" /TR "node C:\ranking-bot\home\run.mjs" /SC DAILY /ST 08:00 /F
   取消：  schtasks /Delete /TN "DailyRanking" /F

注意：電腦 8:00 要開機且有網路；若要睡眠中也執行，需在「工作排程器」該工作的條件頁勾選「喚醒電腦以執行此工作」。
