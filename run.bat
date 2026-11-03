@echo off
cd /d "%~dp0"
echo Starting ParkPulse on http://localhost:9090 ...
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:9090"
npm start
