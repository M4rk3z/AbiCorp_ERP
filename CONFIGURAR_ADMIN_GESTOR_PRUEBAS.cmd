@echo off
setlocal
chcp 65001 >nul
title ABICORP - Administrador del Gestor de Pruebas
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\save-control-test-admin.ps1"
set "configExitCode=%errorlevel%"

echo.
if "%configExitCode%"=="0" (
  echo Administrador de pruebas configurado.
) else (
  echo No fue posible configurar el administrador de pruebas.
)
echo Presiona una tecla para cerrar.
pause >nul

endlocal & exit /b %configExitCode%
