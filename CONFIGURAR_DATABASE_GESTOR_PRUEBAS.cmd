@echo off
setlocal
chcp 65001 >nul
title ABICORP - Configurar PostgreSQL de Pruebas
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\save-control-postgres-url.ps1" -EnvironmentName test
set "configExitCode=%errorlevel%"

echo.
if "%configExitCode%"=="0" (
  echo Configuracion terminada. Ya puedes usar INICIAR_AMBIENTE_PRUEBAS.cmd.
) else (
  echo No fue posible guardar la configuracion de pruebas.
)
echo Presiona una tecla para cerrar.
pause >nul

endlocal & exit /b %configExitCode%
