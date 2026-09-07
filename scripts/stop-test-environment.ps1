param(
  [int]$ControlPort = 5151,
  [int]$ErpPort = 5150
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$erpStopper = Join-Path $PSScriptRoot "stop-erp-test-postgres.ps1"
$controlStopper = Join-Path $PSScriptRoot "stop-control-postgres.ps1"
$failures = [System.Collections.Generic.List[string]]::new()

Write-Host ""
Write-Host "ABICORP - DETENER AMBIENTE DE PRUEBAS"
Write-Host ""

try {
  Write-Host "[1/2] Deteniendo ERP de pruebas..."
  & $erpStopper -Port $ErpPort
} catch {
  $failures.Add("ERP: $($_.Exception.Message)")
}

try {
  Write-Host "[2/2] Deteniendo Centro de Gestion de pruebas..."
  & $controlStopper -Port $ControlPort -EnvironmentName test
} catch {
  $failures.Add("Gestor: $($_.Exception.Message)")
}

if ($failures.Count -gt 0) {
  throw ($failures -join [Environment]::NewLine)
}

Write-Host ""
Write-Host "Ambiente de pruebas detenido correctamente." -ForegroundColor Green
