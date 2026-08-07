@echo off
setlocal
chcp 65001 >nul
title ABICORP - ERP PRUEBAS
cd /d "%~dp0"

echo ============================================================
echo                  ABICORP ERP - PRUEBAS
echo ============================================================
echo.
echo Se usara exclusivamente PostgreSQL de pruebas.
echo El Gestor de pruebas en 5151 no sera detenido.
echo El navegador abrira http://127.0.0.1:5150 cuando este listo.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-erp-test-postgres.ps1" -Port 5150 -OpenBrowser
set "erpExitCode=%errorlevel%"

if not "%erpExitCode%"=="0" (
  echo.
  echo El ERP de pruebas no pudo iniciarse.
  echo Revisa el mensaje anterior y presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %erpExitCode%
