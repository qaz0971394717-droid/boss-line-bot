@echo off
cd /d "%~dp0"
echo ===== Daily ranking setup =====
where node >nul 2>nul
if errorlevel 1 goto nonode

echo Installing components, please wait...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto fail

if exist home\.env goto haveenv
echo.
echo Paste your LINE Channel access token (right-click to paste), then press Enter:
set /p TOKEN=
>home\.env echo LINE_CHANNEL_ACCESS_TOKEN=%TOKEN%
>>home\.env echo RANKING_SOURCE_URL=https://jable.tv/hot/
:haveenv

echo.
echo Testing with Chrome (nothing is sent to LINE)...
echo --------------------------------
set SHOW_BROWSER=1
node home\run.mjs --dry
echo --------------------------------
echo.
echo If you see a TOP 10 list above, it works.
echo If it says the ranking could not be fetched, take a screenshot and send it to me, then close this window.
echo.
set /p GO=If it worked, type Y and press Enter to schedule 08:00 daily: 
if /i not "%GO%"=="Y" goto end
schtasks /Create /TN "DailyRanking" /TR "\"%~dp0run-daily.bat\"" /SC DAILY /ST 08:00 /F
echo.
echo Scheduled for 08:00 every day. To send one now, run:  node home\run.mjs
goto end

:nonode
echo Node.js not found. Install the LTS version from https://nodejs.org then run setup.bat again.
goto end

:fail
echo Installing components failed. Take a screenshot and send it to me.

:end
echo.
pause
