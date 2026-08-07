$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configDirectory = Join-Path $projectRoot "config-local"
$configPath = Join-Path $configDirectory "control-test-admin.json"
$passwordBstr = [IntPtr]::Zero
$confirmationBstr = [IntPtr]::Zero
$plainPassword = $null
$plainConfirmation = $null

Write-Host ""
Write-Host "ABICORP - Administrador inicial del ambiente de pruebas"
Write-Host "La contraseña quedará cifrada para tu usuario de Windows."
Write-Host ""

try {
  $username = (Read-Host "Usuario inicial [control.test]").Trim()
  if (-not $username) { $username = "control.test" }
  if ($username -notmatch '^[a-zA-Z0-9._-]{3,80}$') {
    throw "El usuario debe tener entre 3 y 80 caracteres válidos."
  }

  $password = Read-Host "Contraseña temporal" -AsSecureString
  $confirmation = Read-Host "Confirma la contraseña temporal" -AsSecureString
  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $confirmationBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationBstr)

  if ($plainPassword -ne $plainConfirmation) { throw "Las contraseñas no coinciden." }
  if ($plainPassword.Length -lt 12 -or $plainPassword -notmatch '[A-Z]' -or
      $plainPassword -notmatch '[a-z]' -or $plainPassword -notmatch '[0-9]' -or
      $plainPassword -notmatch '[^a-zA-Z0-9]') {
    throw "Usa al menos 12 caracteres, mayúscula, minúscula, número y símbolo."
  }

  New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
  [ordered]@{
    username = $username
    encryptedPassword = ConvertFrom-SecureString -SecureString $password
  } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8

  Write-Host ""
  Write-Host "Administrador de pruebas guardado de forma cifrada."
  Write-Host "En el primer acceso el sistema solicitará reemplazar la contraseña temporal."
} finally {
  if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
  if ($confirmationBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationBstr) }
  $plainPassword = $null
  $plainConfirmation = $null
}
