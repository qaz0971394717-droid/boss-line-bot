@echo off
cd /d "%~dp0"
echo Looking up Wikipedia, wait a moment...
if exist "%~dp0wiki-test.mjs" (
  node "%~dp0wiki-test.mjs"
) else (
  node "%~dp0home\wiki-test.mjs"
)
echo.
echo Take a screenshot of this window and send it to me.
pause
