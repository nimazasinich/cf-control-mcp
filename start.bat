@echo off
cd /d "%~dp0"

echo Loading local environment...
if not exist .env (
 echo ERROR: .env file missing
 pause
 exit /b 1
)

python main.py
pause
