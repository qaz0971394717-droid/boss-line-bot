@echo off
cd /d "%~dp0"
echo Saving sample pages, wait up to 2 minutes...
node home\inspect.mjs
echo.
echo Done. Send me the 3 files named sample-*.html in the home folder.
explorer home
pause
