@echo off
setlocal
chcp 65001 >nul
title ABICORP - Centro de Gestion
cd /d "%~dp0"

echo ============================================================
echo              ABICORP - CENTRO DE GESTION
echo ============================================================
echo.
echo La URL se cargara cifrada desde la carpeta config-local.
echo Si aun no la configuraste, ejecuta CONFIGURAR_DATABASE_GESTOR.cmd.
echo El navegador se abrira automaticamente cuando el Gestor este listo.
echo Esta ventana se cerrara y el servidor continuara en segundo plano.
echo.

call "%~dp0start-control-postgres.cmd" -EnvironmentName production -Port 5051 -Detached -OpenBrowser
set "gestorExitCode=%errorlevel%"

if not "%gestorExitCode%"=="0" (
  echo.
  echo El Centro de Gestion no pudo iniciarse.
  echo Revisa el mensaje anterior y presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %gestorExitCode%
