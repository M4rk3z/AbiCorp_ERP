param(
  [ValidateSet("production", "test")]
  [string]$EnvironmentName = "test",
  [switch]$Verify
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$secureFile = if ($EnvironmentName -eq "test") { "postgres-test-url.secure" } else { "postgres-external-url.secure" }
$securePath = Join-Path $projectRoot "config-local\$secureFile"
$nodeExecutable = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$previousUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$bstr = [IntPtr]::Zero

try {
  if (-not (Test-Path -LiteralPath $securePath)) { throw "No existe la URL cifrada para $EnvironmentName." }
  $secureUrl = ConvertTo-SecureString -String ((Get-Content -LiteralPath $securePath -Raw -Encoding utf8).Trim())
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ($plainUrl -notmatch "^postgres(?:ql)?://") { throw "La configuracion no contiene una URL PostgreSQL valida." }
  if ($plainUrl -notmatch "[?&]sslmode=") { $plainUrl += $(if ($plainUrl.Contains("?")) { "&sslmode=require" } else { "?sslmode=require" }) }
  if ($plainUrl -notmatch "[?&]uselibpqcompat=") { $plainUrl += "&uselibpqcompat=true" }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $plainUrl, "Process")
  $nodeScript = if ($Verify) { "verify-hr-identity-postgres.mjs" } else { "apply-postgres-schema-migrations.mjs" }
  & $nodeExecutable (Join-Path $PSScriptRoot $nodeScript)
  if ($LASTEXITCODE -ne 0) { throw "La aplicacion de migraciones termino con codigo $LASTEXITCODE." }
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousUrl, "Process")
  $plainUrl = $null
}
