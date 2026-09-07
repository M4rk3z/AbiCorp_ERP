param(
  [string]$Source,
  [ValidateSet("production", "test")]
  [string]$EnvironmentName = "production",
  [switch]$Confirm,
  [switch]$Replace
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if (-not $Source) {
  $latestBackup = Get-ChildItem -LiteralPath (Join-Path $projectRoot "backups") -Directory -Filter "sqlite-pre-postgres-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latestBackup) {
    throw "No se encontró un respaldo SQLite en la carpeta backups."
  }
  $Source = Join-Path $latestBackup.FullName "data"
}

$sourcePath = [System.IO.Path]::GetFullPath($Source)
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "abicorp-control.db"))) {
  throw "La carpeta seleccionada no contiene abicorp-control.db: $sourcePath"
}

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

$migrationScript = Join-Path $projectRoot "scripts\migrate-sqlite-to-postgres.mjs"
$migrationArguments = @($migrationScript, "--source", $sourcePath)

if (-not $Confirm) {
  & $nodeExecutable @migrationArguments
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Se copiará el respaldo a PostgreSQL y se reemplazarán las tablas de destino."
$confirmation = Read-Host "Escribe MIGRAR para continuar"
if ($confirmation -cne "MIGRAR") {
  Write-Host "Migración cancelada."
  exit 1
}

$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousProvider = [Environment]::GetEnvironmentVariable("DATABASE_PROVIDER", "Process")
$secureUrl = $null
$plainUrl = $previousDatabaseUrl
$bstr = [IntPtr]::Zero
$secureConfigFile = if ($EnvironmentName -eq "test") { "postgres-test-url.secure" } else { "postgres-external-url.secure" }
$secureConfigPath = Join-Path $projectRoot "config-local\$secureConfigFile"

try {
  if (-not $plainUrl) {
    if (Test-Path -LiteralPath $secureConfigPath) {
      $encryptedUrl = (Get-Content -LiteralPath $secureConfigPath -Raw -Encoding utf8).Trim()
      $secureUrl = ConvertTo-SecureString -String $encryptedUrl -ErrorAction Stop
      Write-Host "Configuracion PostgreSQL cifrada cargada para $EnvironmentName."
    } else {
      $secureUrl = Read-Host "Pega la External Database URL de Render" -AsSecureString
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
  $migrationArguments += "--confirm"
  if ($Replace) {
    $migrationArguments += "--replace"
  }
  $diagnosticPath = Join-Path $projectRoot "postgres-migration-last.log"
  Set-Content -LiteralPath $diagnosticPath -Value "Diagnóstico de migración PostgreSQL" -Encoding utf8
  & $nodeExecutable @migrationArguments 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    Add-Content -LiteralPath $diagnosticPath -Value $line -Encoding utf8
  }
  $migrationExitCode = $LASTEXITCODE
  if ($migrationExitCode -ne 0) {
    throw "La migración terminó con código $migrationExitCode. Diagnóstico: $diagnosticPath"
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", $previousProvider, "Process")
  $plainUrl = $null
}
