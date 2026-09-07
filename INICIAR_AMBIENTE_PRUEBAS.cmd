@echo off
setlocal
chcp 65001 >nul
title ABICORP - Gestor y ERP de PRUEBAS
cd /d "%~dp0"

echo ============================================================
echo          ABICORP - AMBIENTE INTEGRADO DE PRUEBAS
echo ============================================================
echo.
echo Este acceso iniciara el Centro de Gestion y el ERP de pruebas.
echo La primera conexion con PostgreSQL puede tardar varios minutos.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-test-environment.ps1" -ControlPort 5151 -ErpPort 5150 -OpenBrowser
set "startExitCode=%errorlevel%"

if not "%startExitCode%"=="0" (
  echo.
  echo El ambiente de pruebas no pudo iniciarse completamente.
  echo Revisa el mensaje anterior. Si falta configuracion, ejecuta:
  echo CONFIGURAR_DATABASE_GESTOR_PRUEBAS.cmd
  echo.
  echo Presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %startExitCode%
