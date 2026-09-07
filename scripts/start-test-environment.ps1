param(
  [int]$ControlPort = 5151,
  [int]$ErpPort = 5150,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$controlStarter = Join-Path $PSScriptRoot "start-control-postgres.ps1"
$erpStarter = Join-Path $PSScriptRoot "start-erp-test-postgres.ps1"
$controlStopper = Join-Path $PSScriptRoot "stop-control-postgres.ps1"
$controlUrl = "http://127.0.0.1:$ControlPort"
$erpUrl = "http://127.0.0.1:$ErpPort"
$controlStartedHere = $false

function Test-HttpHealth([string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $controlStarter) -or -not (Test-Path -LiteralPath $erpStarter)) {
  throw "No se encontraron los scripts de inicio del ambiente de pruebas."
}

Write-Host ""
Write-Host "ABICORP - AMBIENTE INTEGRADO DE PRUEBAS"
Write-Host "Gestor: $controlUrl"
Write-Host "ERP:    $erpUrl"
Write-Host ""

try {
  $controlWasReady = Test-HttpHealth "$controlUrl/api/control/health"
  Write-Host "[1/2] Preparando Centro de Gestion..."
  & $controlStarter -Port $ControlPort -EnvironmentName test -Detached
  $controlStartedHere = -not $controlWasReady

  Write-Host "[2/2] Preparando ERP de pruebas..."
  & $erpStarter -Port $ErpPort

  Write-Host ""
  Write-Host "Ambiente de pruebas disponible." -ForegroundColor Green
  Write-Host "Centro de Gestion: $controlUrl"
  Write-Host "ERP:               $erpUrl"
  Write-Host "Portal:            $erpUrl/portal"

  if ($OpenBrowser) {
    try {
      Start-Process $controlUrl
      Start-Process $erpUrl
    } catch {
      Write-Warning "No se pudo abrir el navegador. Usa las direcciones mostradas arriba."
    }
  }
} catch {
  if ($controlStartedHere) {
    Write-Warning "El ambiente no quedo completo; se detendra el Gestor iniciado por este acceso."
    try { & $controlStopper -Port $ControlPort -EnvironmentName test } catch {
      Write-Warning "No se pudo retirar automaticamente el Gestor: $($_.Exception.Message)"
    }
  }
  throw
}
