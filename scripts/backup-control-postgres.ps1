param(
  [ValidateSet("production", "test")]
  [string]$EnvironmentName = "production"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$secureConfigFile = if ($EnvironmentName -eq "test") { "postgres-test-url.secure" } else { "postgres-external-url.secure" }
$secureConfigPath = Join-Path $projectRoot "config-local\$secureConfigFile"
$backupDirectory = Join-Path $projectRoot "backups\postgres"
$postgresBin = "C:\Program Files\PostgreSQL\18\bin"
$pgDump = Join-Path $postgresBin "pg_dump.exe"
$pgRestore = Join-Path $postgresBin "pg_restore.exe"

if (-not (Test-Path -LiteralPath $secureConfigPath)) {
  throw "No existe la configuración cifrada de PostgreSQL de producción."
}
if (-not (Test-Path -LiteralPath $pgDump) -or -not (Test-Path -LiteralPath $pgRestore)) {
  throw "No se encontraron pg_dump y pg_restore de PostgreSQL 18."
}

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeEnvironmentName = ($EnvironmentName -replace '[^a-zA-Z0-9_-]', '-').ToLowerInvariant()
$backupPath = Join-Path $backupDirectory "abicorp-$safeEnvironmentName-$timestamp.dump"
$manifestPath = "$backupPath.json"
$bstr = [IntPtr]::Zero
$plainUrl = $null
$previousPgPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
$previousPgSslMode = [Environment]::GetEnvironmentVariable("PGSSLMODE", "Process")

try {
  $encryptedUrl = (Get-Content -LiteralPath $secureConfigPath -Raw -Encoding utf8).Trim()
  $secureUrl = ConvertTo-SecureString -String $encryptedUrl -ErrorAction Stop
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $parsedUrl = [Uri]$plainUrl
  $userInfo = $parsedUrl.UserInfo.Split(':', 2)
  if ($userInfo.Count -ne 2 -or -not $parsedUrl.Host) {
    throw "La configuración cifrada no contiene una URL PostgreSQL válida."
  }

  $databaseName = [Uri]::UnescapeDataString($parsedUrl.AbsolutePath.TrimStart('/'))
  $databaseUser = [Uri]::UnescapeDataString($userInfo[0])
  $databasePassword = [Uri]::UnescapeDataString($userInfo[1])
  $databasePort = if ($parsedUrl.Port -gt 0) { [string]$parsedUrl.Port } else { "5432" }
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $databasePassword, "Process")
  [Environment]::SetEnvironmentVariable("PGSSLMODE", "require", "Process")

  Write-Host "Creando respaldo lógico de PostgreSQL..."
  & $pgDump --host $parsedUrl.Host --port $databasePort --username $databaseUser `
    --dbname $databaseName --format custom --no-owner --no-privileges --file $backupPath
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    throw "pg_dump terminó con código $LASTEXITCODE."
  }

  $contents = & $pgRestore --list $backupPath
  if ($LASTEXITCODE -ne 0 -or -not $contents) {
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    throw "El respaldo no superó la validación de pg_restore."
  }

  $backupFile = Get-Item -LiteralPath $backupPath
  $hash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest = [ordered]@{
    environment = $safeEnvironmentName
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    database = $databaseName
    format = "PostgreSQL custom"
    pgDumpVersion = (& $pgDump --version)
    sizeBytes = $backupFile.Length
    sha256 = $hash
    catalogEntries = @($contents).Count
    backupFile = $backupFile.Name
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

  Write-Host "Respaldo creado y validado."
  Write-Host "Archivo: $backupPath"
  Write-Host "Tamaño: $($backupFile.Length) bytes"
  Write-Host "SHA-256: $hash"
  Write-Host "Entradas verificadas: $(@($contents).Count)"
} finally {
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPgPassword, "Process")
  [Environment]::SetEnvironmentVariable("PGSSLMODE", $previousPgSslMode, "Process")
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $plainUrl = $null
  $databasePassword = $null
}
