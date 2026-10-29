@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Story Teller
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non è installato. Scarica la versione LTS da https://nodejs.org e riapri start.bat.
  pause
  exit /b 1
)
echo Avvio di AI Story Teller (chiudi questa finestra per fermarlo)...
node scripts\start.mjs
if errorlevel 1 (
  echo.
  echo Si è verificato un errore. Premi un tasto per chiudere.
  pause >nul
)
