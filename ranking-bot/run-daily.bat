@echo off
cd /d "%~dp0"
node home\run.mjs >> home\log.txt 2>&1
