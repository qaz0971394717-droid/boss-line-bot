@echo off
cd /d "%~dp0"
echo A Chrome window will open. Wait up to 30 seconds.
echo If a "verify you are human" box appears in the window, click it.
set SHOW_BROWSER=1
set DEBUG=1
node home\run.mjs --dry
echo.
echo Take a screenshot of this window and send it to me.
pause
