param(
  [int]$Port = 5051
)

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

$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousProvider = [Environment]::GetEnvironmentVariable("DATABASE_PROVIDER", "Process")
$previousPort = [Environment]::GetEnvironmentVariable("ERP_CONTROL_PORT", "Process")
$previousHost = [Environment]::GetEnvironmentVariable("ERP_CONTROL_HOST", "Process")
$secureUrl = $null
$plainUrl = $previousDatabaseUrl
$bstr = [IntPtr]::Zero

try {
  if (-not $plainUrl) {
    $secureUrl = Read-Host "Pega la External Database URL de Render" -AsSecureString
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
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", $previousProvider, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_PORT", $previousPort, "Process")
  [Environment]::SetEnvironmentVariable("ERP_CONTROL_HOST", $previousHost, "Process")
  $plainUrl = $null
}
