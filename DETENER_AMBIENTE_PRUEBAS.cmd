@echo off
setlocal
chcp 65001 >nul
title ABICORP - Detener Gestor y ERP de PRUEBAS
cd /d "%~dp0"

echo ============================================================
echo          ABICORP - DETENER AMBIENTE DE PRUEBAS
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-test-environment.ps1" -ControlPort 5151 -ErpPort 5150
set "stopExitCode=%errorlevel%"

if not "%stopExitCode%"=="0" (
  echo.
  echo El ambiente de pruebas no pudo detenerse completamente.
  echo Revisa el mensaje anterior y presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %stopExitCode%
