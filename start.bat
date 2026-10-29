@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installo le dipendenze...
  call npm install || goto :error
)
if not exist dist\index.html (
  echo Preparo l'interfaccia...
  call npm run build || goto :error
)
start "" http://localhost:5178
node server\index.ts
goto :eof
:error
echo Si e' verificato un errore. Premi un tasto per chiudere.
pause >nul
