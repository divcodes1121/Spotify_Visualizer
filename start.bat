@echo off
title Aura - Spotify Visual Player
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get it from https://nodejs.org ^(LTS^) and run this again.
  echo.
  pause
  exit /b 1
)
if not exist "test-media\images\neon-tide.png" (
  echo   Generating test media...
  node tools\generate-test-media.js
)
node server.js --open
pause
