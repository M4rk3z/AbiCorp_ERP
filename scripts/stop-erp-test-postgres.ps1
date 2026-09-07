param([int]$Port = 5150)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$pidPath = Join-Path $projectRoot "config-local\erp-server-test.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  $listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listener.Count -gt 0) {
    throw "Hay un proceso en el puerto $Port que no fue iniciado por INICIAR_AMBIENTE_PRUEBAS.cmd. No se detendra automaticamente."
  }
  Write-Host "El ERP de pruebas ya esta detenido."
  return
}

$savedPid = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedPid)) {
  throw "El archivo de control del ERP de pruebas no contiene un PID valido."
}

$process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host "El ERP de pruebas ya estaba detenido."
  return
}
if ($process.ProcessName -ne "node") {
  throw "El PID guardado ya no pertenece a Node.js. Se cancelo el apagado por seguridad."
}

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0 -and -not ($listeners | Where-Object { $_.OwningProcess -eq $savedPid })) {
  throw "El puerto $Port pertenece a otro proceso. Se cancelo el apagado por seguridad."
}
if ($listeners.Count -eq 0) {
  $pidFile = Get-Item -LiteralPath $pidPath
  $recentStartup = ((Get-Date) - $pidFile.LastWriteTime).TotalMinutes -le 5 -and
    [Math]::Abs(($pidFile.LastWriteTime - $process.StartTime).TotalSeconds) -le 30
  if (-not $recentStartup) {
    Remove-Item -LiteralPath $pidPath -Force
    Write-Host "Se elimino un registro antiguo. No se detuvo ningun proceso."
    return
  }
}

Stop-Process -Id $savedPid -Force
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Host "ERP de pruebas detenido correctamente."
