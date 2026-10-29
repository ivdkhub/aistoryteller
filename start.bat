@echo off
cd /d "%~dp0"
title AI Story Teller
if not exist node_modules (
  echo Installo le dipendenze...
  call npm install || goto :error
)
if not exist dist\index.html (
  echo Preparo l'interfaccia...
  call npm run build || goto :error
)
echo Avvio di AI Story Teller su http://localhost:5178 (chiudi questa finestra per fermarlo)
set OPEN_BROWSER=1
node server\index.ts
goto :eof
:error
echo Si e' verificato un errore. Premi un tasto per chiudere.
pause >nul
