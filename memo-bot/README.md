# 個人備忘機器人

獨立 Worker `hongzhe-personal-memo`、獨立 D1 `hongzhe-personal-memo`。僅接受已設定本人 LINE ID 的一對一私訊，其他使用者、群組及一般聊天不存檔、不回覆。不建立 LINE 推播或計時排程。

- `備忘 內容`、`備忘列表`、`查備忘 關鍵字`
- `待辦 內容`、`待辦`、`今天待辦`（包含逾期與未指定日期項目）
- `提醒 明天 15:00 事項`；日期可用今天、明天、後天、YYYY-MM-DD
- `查看 編號`、`文字 編號`、`完成 編號`、`取消完成 編號`、`刪除 編號`

提醒儲存在 LINE 備忘 DB 後，仍須自行點擊加入 Google 日曆並儲存。日曆連結不具 OAuth 存取權限，無法確認事件是否已儲存，也無法設定通知時間或同步更新。請在 Google 日曆設定預設通知（例如提前 10 分鐘）及允許 Android 通知。重複儲存同一連結可能產生重複日曆事件。

私密設定全部透過 GitHub Actions Secrets：`MEMO_LINE_CHANNEL_ACCESS_TOKEN`、`MEMO_LINE_CHANNEL_SECRET`、`MEMO_OWNER_LINE_USER_ID`；共用 Cloudflare 部署授權，沒有共用 LINE 金鑰或資料表。擁有者 ID 缺漏時保持鎖定。

webhook 先驗簽再授權；event ID 持久化去重；不確定執行狀態不會重播寫入。若寫入成功但回覆儲存失敗，事件保留 pending，需要人工核對。沒有公開資料讀取端點，Google 日曆 URL 只在本人回覆內產生。

備份及資料保留：備忘不自動刪除；刪除動作採軟刪除。每天驗證 D1 SQL 備份至私人 R2 後，清除超過 14 天已送達 event（保留未完成），清除超過 30 天軟刪除資料。R2 日常備份保留 30 天。Google 日曆屬使用者自身帳號，與備份分開。
