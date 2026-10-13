@echo off
rem One-click start. Close any old Naqsha terminals first (ports 5173 and 5174 must be free).
rem   landing page : http://localhost:5174   (built version, loads in about 2 seconds)
rem   planner      : http://localhost:5173   (the landing form hands over to it)
cd /d "%~dp0landing"
if not exist node_modules (
  echo Installing dependencies once...
  call npm install
)
start "Naqsha planner 5173" cmd /k "cd /d %~dp0 && python -m http.server 5173"
start "Naqsha landing 5174" cmd /k "npm run view"
