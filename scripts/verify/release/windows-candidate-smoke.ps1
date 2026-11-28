$ErrorActionPreference = 'Stop'
$setup = Join-Path $env:RUNNER_TEMP 'candidate.exe'
$os = Get-CimInstance Win32_OperatingSystem
$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
Write-Output "Operating system: $($os.Caption), build $($os.BuildNumber), $arch"
if ($arch -ne $env:EXPECTED_ARCH) { throw 'Unexpected native runner architecture.' }
$hash = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash $setup -Algorithm SHA512).Hash))
if ($hash -cne $env:EXPECTED_SHA512) { throw 'Installer differs from the feed SHA512.' }
Write-Output "Installer SHA512 matches feed: $hash"
function Assert-ReleaseSignature([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
    throw "Invalid signature or missing timestamp on $(Split-Path $Path -Leaf) ($($signature.Status))."
  }
  $name = $signature.SignerCertificate.GetNameInfo('SimpleName', $false)
  $publisherHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($name)))
  if ($publisherHash -ine $env:EXPECTED_PUBLISHER_HASH) { throw 'Unexpected Authenticode publisher.' }
  Write-Output "Valid timestamped Authenticode signature and expected publisher on $(Split-Path $Path -Leaf)."
}
Assert-ReleaseSignature $setup
$installer = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru
if (!$installer.WaitForExit(300000)) { throw 'Installation timed out.' }
if ($installer.ExitCode -ne 0) { throw "Installation failed ($($installer.ExitCode))." }
$expectedDisplay = "Pulsatrix Sagax $env:EXPECTED_VERSION"
$entry = @(Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' |
  Where-Object DisplayName -eq $expectedDisplay)
if ($entry.Count -ne 1 -or $entry[0].DisplayVersion -ne $env:EXPECTED_VERSION) { throw 'Expected per-user uninstall registration missing.' }
$shell = New-Object -ComObject WScript.Shell
$links = foreach ($folder in 'Programs','DesktopDirectory') {
  $dir = [Environment]::GetFolderPath($folder)
  $link = @(Get-ChildItem $dir -Filter 'Pulsatrix Sagax.lnk' -Recurse)
  if ($link.Count -ne 1) { throw "Expected one Sagax shortcut in $folder." }
  $shell.CreateShortcut($link[0].FullName).TargetPath
}
# runAfterFinish starts Sagax; stop it so the install folder is idle before we resolve the exe.
Get-Process -Name Sagax -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$uninstallerPath = [regex]::Match($entry[0].UninstallString, '^"([^"]+)"').Groups[1].Value
if (!$uninstallerPath) { throw 'UninstallString did not carry a quoted uninstaller path.' }
$installDir = Split-Path $uninstallerPath
$beside = Join-Path $installDir 'Sagax.exe'
# Prefer Sagax.exe beside the registered uninstaller. On arm64, an older
# published setup (0.8.170) registered the uninstaller before the application
# payload was visible to Get-Item; wait, then fall back to shortcut targets.
$app = $null
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Path -LiteralPath $beside -PathType Leaf) {
    $app = (Get-Item -LiteralPath $beside).FullName
    break
  }
  Start-Sleep -Seconds 1
}
if (!$app) {
  foreach ($target in $links) {
    if ($target -and (Test-Path -LiteralPath $target -PathType Leaf) -and ((Split-Path $target -Leaf) -eq 'Sagax.exe')) {
      $app = (Get-Item -LiteralPath $target).FullName
      Write-Output "Sagax.exe resolved from shortcut target after install-folder probe missed."
      break
    }
  }
}
if (!$app) {
  $listing = @((Get-ChildItem -LiteralPath $installDir -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')
  throw "Sagax.exe missing beside registered uninstaller ($beside). Install folder entries: $listing"
}
$shortcutsValid = ($links[0] -eq $links[1] -and (Test-Path -LiteralPath $links[0] -PathType Leaf) -and $links[0] -eq $app)
Write-Output "Shortcut targets both resolve to registered application: $shortcutsValid"

if ((Split-Path $app -Leaf) -ne 'Sagax.exe' -or !$app.StartsWith("$env:LOCALAPPDATA\Programs\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unexpected installation path.'
}
Write-Output "Per-user registration verified for version $env:EXPECTED_VERSION."
Assert-ReleaseSignature $app
# NSIS writes its signed uninstaller beside the unpacked application after setup.
# The package verifier checks the original payload, which excludes that executable.
$uninstaller = Join-Path (Split-Path $app) 'Uninstall Sagax.exe'
Assert-ReleaseSignature $uninstaller
$held = Join-Path $env:RUNNER_TEMP 'signed-uninstaller.exe'
Move-Item -LiteralPath $uninstaller -Destination $held
try {
  node scripts/verify/release/verify-win-natives.mjs (Split-Path $app) $arch
  if ($LASTEXITCODE -ne 0) { throw 'Native binary architecture validation failed.' }
} finally {
  Move-Item -LiteralPath $held -Destination $uninstaller
}
# Keep application output private. Report only the status of the fresh-profile launch.
$env:ELECTRON_ENABLE_LOGGING = '1'
$smoke = @(node scripts/smoke-packaged-launch.mjs --app $app 2>&1)
if ($LASTEXITCODE -ne 0 -or !($smoke -match 'packaged launch ok in .*fresh userData.*http://127\.0\.0\.1:')) {
  $smoke | ForEach-Object { if ([string]$_ -match '^QA_DIAG [a-zA-Z0-9 =|@_./:-]+$') { Write-Output ([string]$_) } }
  throw 'Packaged renderer did not confirm its local server and desktop bridge within 60 seconds.'
}
Write-Output 'Packaged renderer reached its local server and exercised the preload bridge and owner-only API.'

if (!$shortcutsValid) { throw 'Installed shortcut targets disagree or are missing.' }
