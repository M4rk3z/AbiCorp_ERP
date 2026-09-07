param(
  [int]$Port = 5051,
  [ValidateSet("production", "test")]
  [string]$EnvironmentName = "production",
  [switch]$Detached,
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
  $userProfilePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $nodeExecutable = Join-Path $userProfilePath ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    $projectOwnerPath = Split-Path (Split-Path $projectRoot -Parent) -Parent
    $nodeExecutable = Join-Path $projectOwnerPath ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  }
}

if (-not (Test-Path -LiteralPath $nodeExecutable)) {
  throw "No se encontró node.exe."
}

$controlServer = Join-Path $projectRoot "src\control-server.js"
if (-not (Test-Path -LiteralPath $controlServer)) {
  throw "No se encontró el servidor local del Centro de Gestión."
}

$controlUrl = "http://127.0.0.1:$Port"
$configDirectory = Join-Path $projectRoot "config-local"
$environmentSuffix = if ($EnvironmentName -eq "test") { "-test" } else { "" }
$pidPath = Join-Path $configDirectory "control-server$environmentSuffix.pid"
$outputLogPath = Join-Path $configDirectory "control-server$environmentSuffix.out.log"
$errorLogPath = Join-Path $configDirectory "control-server$environmentSuffix.error.log"

function Test-ControlHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$controlUrl/api/control/health" -TimeoutSec 2
    $payload = $response.Content | ConvertFrom-Json
    return $response.StatusCode -eq 200 -and $payload.service -eq "access-management" -and
      $payload.environment -eq $EnvironmentName
  } catch {
    return $false
  }
}

if ($Detached) {
  if (Test-ControlHealth) {
    Write-Host "El Centro de Gestion ya esta funcionando."
    if ($OpenBrowser) { Start-Process $controlUrl }
    return
  }
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    throw "El puerto $Port esta ocupado por otro proceso y no responde como Centro de Gestion."
  }
}

$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousProvider = [Environment]::GetEnvironmentVariable("DATABASE_PROVIDER", "Process")
$previousPort = [Environment]::GetEnvironmentVariable("ERP_CONTROL_PORT", "Process")
$previousHost = [Environment]::GetEnvironmentVariable("ERP_CONTROL_HOST", "Process")
$previousEnvironment = [Environment]::GetEnvironmentVariable("ERP_ENVIRONMENT", "Process")
$previousControlUser = [Environment]::GetEnvironmentVariable("ERP_CONTROL_USER", "Process")
$previousControlPassword = [Environment]::GetEnvironmentVariable("ERP_CONTROL_PASSWORD", "Process")
$secureUrl = $null
$plainUrl = $previousDatabaseUrl
$bstr = [IntPtr]::Zero
$adminBstr = [IntPtr]::Zero
$plainAdminPassword = $null
$secureConfigFile = if ($EnvironmentName -eq "test") { "postgres-test-url.secure" } else { "postgres-external-url.secure" }
$secureConfigPath = Join-Path $projectRoot "config-local\$secureConfigFile"
$testAdminConfigPath = Join-Path $projectRoot "config-local\control-test-admin.json"

try {
  if ($EnvironmentName -eq "test") {
    if (-not (Test-Path -LiteralPath $testAdminConfigPath)) {
      throw "Configura primero el administrador con CONFIGURAR_ADMIN_GESTOR_PRUEBAS.cmd."
    }
    $adminConfig = Get-Content -LiteralPath $testAdminConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
    $secureAdminPassword = ConvertTo-SecureString -String $adminConfig.encryptedPassword -ErrorAction Stop
    $adminBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
    $plainAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminBstr)
    [Environment]::SetEnvironmentVariable("ERP_CONTROL_USER", [string]$adminConfig.username, "Process")
    [Environment]::SetEnvironmentVariable("ERP_CONTROL_PASSWORD", $plainAdminPassword, "Process")
  }
  if (-not $plainUrl) {
    if (Test-Path -LiteralPath $secureConfigPath) {
      try {
        $encryptedUrl = (Get-Content -LiteralPath $secureConfigPath -Raw -Encoding utf8).Trim()
        $secureUrl = ConvertTo-SecureString -String $encryptedUrl -ErrorAction Stop
        Write-Host "Configuracion PostgreSQL cifrada cargada desde config-local."
      } catch {
        throw "No se pudo descifrar la configuracion local del ambiente $EnvironmentName."
      }
    } else {
      throw "No existe una URL guardada para el ambiente $EnvironmentName."
    }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  if (-not $plainUrl.StartsWith("postgres://") -and -not $plainUrl.StartsWith("postgresql://")) {
    throw "La URL proporcionada no es una conexión PostgreSQL válida."
  }
  $parsedUrl = [Uri]$plainUrl
  if (-not $parsedUrl.Host.Contains(".")) {
    throw "Parece que pegaste Internal Database URL. Copia External Database URL desde Render."
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
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_PORT", [string]$Port, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_HOST", "127.0.0.1", "Process")
  [Environment]::SetEnvironmentVariable("ERP_ENVIRONMENT", $EnvironmentName, "Process")

  if ($Detached) {
    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    Set-Content -LiteralPath $outputLogPath -Value "" -Encoding utf8
    Set-Content -LiteralPath $errorLogPath -Value "" -Encoding utf8
    $childProcess = $null
    try {
      Write-Host "Iniciando Centro de Gestion ($EnvironmentName) en segundo plano..."
      Write-Host "La primera conexion con PostgreSQL puede tardar varios minutos."
      $deadline = (Get-Date).AddMinutes(4)
      $ready = $false
      $startupAttempt = 0
      while ((Get-Date) -lt $deadline) {
        $startupAttempt += 1
        Set-Content -LiteralPath $outputLogPath -Value "" -Encoding utf8
        Set-Content -LiteralPath $errorLogPath -Value "" -Encoding utf8
        $childProcess = Start-Process -WindowStyle Hidden -PassThru -FilePath $nodeExecutable `
          -ArgumentList @($controlServer) -WorkingDirectory $projectRoot `
          -RedirectStandardOutput $outputLogPath -RedirectStandardError $errorLogPath
        Set-Content -LiteralPath $pidPath -Value ([string]$childProcess.Id) -Encoding ascii

        while ((Get-Date) -lt $deadline) {
          $childProcess.Refresh()
          if ($childProcess.HasExited) { break }
          if (Test-ControlHealth) {
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
          throw "El Centro de Gestion se cerro durante el inicio. $details"
        }
        Write-Warning "PostgreSQL interrumpio la conexion inicial. Reintentando ($startupAttempt de 4)..."
        Start-Sleep -Seconds ([Math]::Min($startupAttempt * 2, 6))
      }
      if (-not $ready) {
        throw "El Centro de Gestion no estuvo disponible despues de 4 minutos. Revisa $errorLogPath"
      }

      Write-Host "Centro de Gestion disponible en $controlUrl"
      if ($OpenBrowser) {
        try { Start-Process $controlUrl } catch { Write-Warning "Abre manualmente $controlUrl" }
      }
      return
    } catch {
      if ($childProcess -and -not $childProcess.HasExited) {
        Stop-Process -Id $childProcess.Id -Force -ErrorAction SilentlyContinue
      }
      Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
      throw
    }
  }

  Write-Host ""
  Write-Host "Centro de Gestión conectado a PostgreSQL."
  Write-Host "Cuando aparezca 'disponible', abre http://127.0.0.1:$Port"
  Write-Host "Mantén esta ventana abierta. Usa Ctrl+C para detenerlo."
  Write-Host ""
  & $nodeExecutable $controlServer
  if ($LASTEXITCODE -ne 0) {
    throw "El Centro de Gestión terminó con código $LASTEXITCODE."
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ($adminBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminBstr)
  }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", $previousProvider, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_PORT", $previousPort, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_HOST", $previousHost, "Process")
  [Environment]::SetEnvironmentVariable("ERP_ENVIRONMENT", $previousEnvironment, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_USER", $previousControlUser, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_PASSWORD", $previousControlPassword, "Process")
  $plainUrl = $null
  $plainAdminPassword = $null
}
