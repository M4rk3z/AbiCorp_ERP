param(
  [int]$Port = 5150,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

if ($nodeCommand) {
  $nodeExecutable = $nodeCommand.Source
} else {
  $profileCandidates = @($env:USERPROFILE, [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) |
    Where-Object { $_ } | Select-Object -Unique
  $nodeExecutable = $profileCandidates |
    ForEach-Object { Join-Path $_ ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not (Test-Path -LiteralPath $nodeExecutable)) {
  throw "No se encontro node.exe."
}

$serverPath = Join-Path $projectRoot "src\erp-server.js"
$configDirectory = Join-Path $projectRoot "config-local"
$secureConfigPath = Join-Path $configDirectory "postgres-test-url.secure"
$pidPath = Join-Path $configDirectory "erp-server-test.pid"
$outputLogPath = Join-Path $configDirectory "erp-server-test.out.log"
$errorLogPath = Join-Path $configDirectory "erp-server-test.error.log"
$erpUrl = "http://127.0.0.1:$Port"

function Test-ErpHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$erpUrl/api/health" -TimeoutSec 3
    $payload = $response.Content | ConvertFrom-Json
    return $response.StatusCode -eq 200 -and $payload.status -eq "ok" -and $payload.database -eq "connected"
  } catch {
    return $false
  }
}

if (Test-ErpHealth) {
  Write-Host "El ERP de pruebas ya esta funcionando en $erpUrl"
  if ($OpenBrowser) { Start-Process $erpUrl }
  return
}

$listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
  throw "El puerto $Port esta ocupado por otro proceso y no responde como ERP de pruebas."
}

if (Test-Path -LiteralPath $pidPath) {
  $savedPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedPid)) {
    $staleProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($staleProcess -and $staleProcess.ProcessName -eq "node") {
      throw "Existe un proceso Node registrado para el ERP de pruebas, pero no responde en el puerto $Port. Ejecuta DETENER_AMBIENTE_PRUEBAS.cmd y vuelve a intentarlo."
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $secureConfigPath)) {
  throw "No existe la URL PostgreSQL de pruebas. Ejecuta CONFIGURAR_DATABASE_GESTOR_PRUEBAS.cmd."
}

$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousProvider = [Environment]::GetEnvironmentVariable("DATABASE_PROVIDER", "Process")
$previousPort = [Environment]::GetEnvironmentVariable("ERP_PORT", "Process")
$previousHost = [Environment]::GetEnvironmentVariable("ERP_HOST", "Process")
$previousEnvironment = [Environment]::GetEnvironmentVariable("ERP_ENVIRONMENT", "Process")
$secureUrl = $null
$plainUrl = $null
$bstr = [IntPtr]::Zero
$childProcess = $null

try {
  try {
    $encryptedUrl = (Get-Content -LiteralPath $secureConfigPath -Raw -Encoding utf8).Trim()
    $secureUrl = ConvertTo-SecureString -String $encryptedUrl -ErrorAction Stop
  } catch {
    throw "No se pudo descifrar la URL PostgreSQL de pruebas. Ejecuta este acceso con el mismo usuario de Windows que la guardo."
  }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if (-not $plainUrl.StartsWith("postgres://") -and -not $plainUrl.StartsWith("postgresql://")) {
    throw "La URL guardada no es una conexion PostgreSQL valida."
  }
  $parsedUrl = [Uri]$plainUrl
  if (-not $parsedUrl.Host.Contains(".")) {
    throw "La configuracion parece contener la Internal Database URL. Guarda la External Database URL de Render."
  }
  if ($plainUrl -notmatch "[?&]sslmode=") {
    $separator = if ($plainUrl.Contains("?")) { "&" } else { "?" }
    $plainUrl = $plainUrl + $separator + "sslmode=require"
  }
  if ($plainUrl -notmatch "[?&]uselibpqcompat=") {
    $separator = if ($plainUrl.Contains("?")) { "&" } else { "?" }
    $plainUrl = $plainUrl + $separator + "uselibpqcompat=true"
  }

  [Environment]::SetEnvironmentVariable("DATABASE_URL", $plainUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", "postgres", "Process")
  [Environment]::SetEnvironmentVariable("ERP_PORT", [string]$Port, "Process")
  [Environment]::SetEnvironmentVariable("ERP_HOST", "127.0.0.1", "Process")
  [Environment]::SetEnvironmentVariable("ERP_ENVIRONMENT", "test", "Process")

  New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
  Set-Content -LiteralPath $outputLogPath -Value "" -Encoding utf8
  Set-Content -LiteralPath $errorLogPath -Value "" -Encoding utf8
  Write-Host "Iniciando ERP de pruebas en segundo plano..."
  Write-Host "La base gratuita de Render puede tardar varios minutos en despertar."
  $deadline = (Get-Date).AddMinutes(4)
  $ready = $false
  $startupAttempt = 0
  while ((Get-Date) -lt $deadline) {
    $startupAttempt += 1
    Set-Content -LiteralPath $outputLogPath -Value "" -Encoding utf8
    Set-Content -LiteralPath $errorLogPath -Value "" -Encoding utf8
    $childProcess = Start-Process -WindowStyle Hidden -PassThru -FilePath $nodeExecutable `
      -ArgumentList @($serverPath) -WorkingDirectory $projectRoot `
      -RedirectStandardOutput $outputLogPath -RedirectStandardError $errorLogPath
    Set-Content -LiteralPath $pidPath -Value ([string]$childProcess.Id) -Encoding ascii

    while ((Get-Date) -lt $deadline) {
      $childProcess.Refresh()
      if ($childProcess.HasExited) { break }
      if (Test-ErpHealth) {
        $ready = $true
        break
      }
      Start-Sleep -Milliseconds 750
    }
    if ($ready) { break }
    if (-not $childProcess.HasExited) { break }

    $details = (Get-Content -LiteralPath $errorLogPath -Tail 16 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
    $transientFailure = $details -match "(?i)connection terminated|ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|socket hang up|57P0[123]|08[0-9A-Z]{3}|tiempo agotado.*PostgreSQL"
    if (-not $transientFailure -or $startupAttempt -ge 4) {
      throw "El ERP de pruebas se cerro durante el inicio. $details"
    }
    Write-Warning "PostgreSQL interrumpio la conexion inicial. Reintentando ($startupAttempt de 4)..."
    Start-Sleep -Seconds ([Math]::Min($startupAttempt * 2, 6))
  }
  if (-not $ready) {
    throw "El ERP de pruebas no estuvo disponible despues de 4 minutos. Revisa $errorLogPath"
  }

  Write-Host "ERP de pruebas disponible en $erpUrl"
  Write-Host "Portal de colaboradores: $erpUrl/portal"
  if ($OpenBrowser) { Start-Process $erpUrl }
} catch {
  if ($childProcess -and -not $childProcess.HasExited) {
    Stop-Process -Id $childProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  throw
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", $previousProvider, "Process")
  [Environment]::SetEnvironmentVariable("ERP_PORT", $previousPort, "Process")
  [Environment]::SetEnvironmentVariable("ERP_HOST", $previousHost, "Process")
  [Environment]::SetEnvironmentVariable("ERP_ENVIRONMENT", $previousEnvironment, "Process")
  $plainUrl = $null
}
