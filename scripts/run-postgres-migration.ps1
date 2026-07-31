param(
  [string]$Source,
  [switch]$Confirm,
  [switch]$Replace
)

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

try {
  if (-not $plainUrl) {
    $secureUrl = Read-Host "Pega la External Database URL de Render" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  if (-not $plainUrl.StartsWith("postgres://") -and -not $plainUrl.StartsWith("postgresql://")) {
    throw "La URL proporcionada no es una conexión PostgreSQL válida."
  }

  [Environment]::SetEnvironmentVariable("DATABASE_URL", $plainUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", "postgres", "Process")
  $migrationArguments += "--confirm"
  if ($Replace) {
    $migrationArguments += "--replace"
  }
  & $nodeExecutable @migrationArguments
  if ($LASTEXITCODE -ne 0) {
    throw "La migración terminó con código $LASTEXITCODE."
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_PROVIDER", $previousProvider, "Process")
  $plainUrl = $null
}
