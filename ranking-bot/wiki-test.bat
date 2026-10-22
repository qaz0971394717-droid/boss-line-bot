@echo off
cd /d "%~dp0"
echo Looking up Wikipedia, wait a moment...
node home\wiki-test.mjs
echo.
echo Take a screenshot of this window and send it to me.
pause
