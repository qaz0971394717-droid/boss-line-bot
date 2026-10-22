@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===== 每日排行 設定 =====
where node >nul 2>nul
if errorlevel 1 goto nonode

if exist home\.env goto haveenv
echo.
echo 請貼上 LINE 的 Channel access token（在視窗按右鍵即可貼上），再按 Enter：
set /p TOKEN=
>home\.env echo LINE_CHANNEL_ACCESS_TOKEN=%TOKEN%
>>home\.env echo RANKING_SOURCE_URL=https://jable.tv/hot/
:haveenv

echo.
echo 測試中（只顯示，不推播）...
echo --------------------------------
node home\run.mjs --dry
echo --------------------------------
echo.
echo 上面如果有看到 TOP 10 的清單就是成功。
echo 如果寫「今天抓不到」，請把上面的文字截圖給我，先不要繼續。
echo.
set /p GO=成功的話輸入 Y 再按 Enter 設定每天早上 8 點自動推播：
if /i not "%GO%"=="Y" goto end
schtasks /Create /TN "DailyRanking" /TR "\"%~dp0run-daily.bat\"" /SC DAILY /ST 08:00 /F
echo.
echo 已設定每天 08:00 自動執行。要立刻推一次測試請輸入：  node home\run.mjs
goto end

:nonode
echo 找不到 Node.js，請先到 https://nodejs.org 下載安裝 LTS 版，裝好後重新按兩下 setup.bat。

:end
echo.
pause
