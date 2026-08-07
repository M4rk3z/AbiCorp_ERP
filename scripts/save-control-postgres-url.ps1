param(
  [ValidateSet("production", "test")]
  [string]$EnvironmentName = "production"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configDirectory = Join-Path $projectRoot "config-local"
$secureConfigFile = if ($EnvironmentName -eq "test") { "postgres-test-url.secure" } else { "postgres-external-url.secure" }
$secureConfigPath = Join-Path $configDirectory $secureConfigFile
$secureUrl = $null
$plainUrl = $null
$bstr = [IntPtr]::Zero

Write-Host ""
Write-Host "ABICORP - Configuracion segura del Centro de Gestion"
Write-Host "Ambiente: $($EnvironmentName.ToUpperInvariant())"
Write-Host "La URL se cifrara para este usuario de Windows y no se guardara como texto."
Write-Host ""

try {
  $secureUrl = Read-Host "Pega la External Database URL de Render" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  if (-not $plainUrl.StartsWith("postgres://") -and -not $plainUrl.StartsWith("postgresql://")) {
    throw "La URL proporcionada no es una conexion PostgreSQL valida."
  }
  $parsedUrl = [Uri]$plainUrl
  if (-not $parsedUrl.Host.Contains(".")) {
    throw "Parece que pegaste Internal Database URL. Copia External Database URL desde Render."
  }

  New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
  $encrypted = ConvertFrom-SecureString -SecureString $secureUrl
  Set-Content -LiteralPath $secureConfigPath -Value $encrypted -Encoding utf8
  Write-Host ""
  Write-Host "URL cifrada guardada en: $secureConfigPath"
  Write-Host "Solamente tu usuario de Windows en este equipo puede descifrarla."
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $plainUrl = $null
}
