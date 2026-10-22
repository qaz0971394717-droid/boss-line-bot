@echo off
cd /d "%~dp0"
set SHOW_BROWSER=1
node home\run.mjs >> home\log.txt 2>&1
