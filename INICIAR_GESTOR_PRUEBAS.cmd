@echo off
setlocal
chcp 65001 >nul
title ABICORP - Centro de Gestion PRUEBAS
cd /d "%~dp0"

echo ============================================================
echo        ABICORP - CENTRO DE GESTION - AMBIENTE PRUEBAS
echo ============================================================
echo.
echo Se usara exclusivamente la base PostgreSQL de pruebas.
echo El navegador abrira http://127.0.0.1:5151 cuando este listo.
echo.

call "%~dp0start-control-postgres.cmd" -EnvironmentName test -Port 5151 -Detached -OpenBrowser
set "gestorExitCode=%errorlevel%"

if not "%gestorExitCode%"=="0" (
  echo.
  echo El Centro de Gestion de pruebas no pudo iniciarse.
  echo Ejecuta primero CONFIGURAR_DATABASE_GESTOR_PRUEBAS.cmd.
  echo Presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %gestorExitCode%
