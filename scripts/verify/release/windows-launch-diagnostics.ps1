param([int]$RootProcess)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$family = @(Get-Process -Name Sagax -ErrorAction SilentlyContinue)
Write-Output "QA_DIAG appProcesses=$($family.Count) rootSession=$((Get-Process -Id $RootProcess).SessionId) probeSession=$((Get-Process -Id $PID).SessionId)"
$labels = @{
  'JavaScript error' = 'js-error-dialog'
  'Cannot find module' = 'module-not-found'
  'Cannot find package' = 'package-not-found'
  'DLL' = 'dll-message'
  'ERR_MODULE_NOT_FOUND' = 'err-module-not-found'
  'ENOENT' = 'missing-path'
  'Entry Point Not Found' = 'entry-point-missing'
  'side-by-side' = 'side-by-side'
  'could not be initialized' = 'initialization-failed'
  'local server' = 'local-server'
  'SmartScreen' = 'smartscreen'
  'Sagax' = 'product-window'
}
$seen = @{}
$tree = [System.Windows.Automation.AutomationElement]::RootElement
foreach ($window in $tree.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
  if ($window.Current.ProcessId -notin $family.Id) { continue }
  $parts = @($window.Current.Name)
  $parts += @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })
  $ui = $parts -join ' '
  foreach ($label in $labels.Keys) { if ($ui -match [regex]::Escape($label)) { $seen[$labels[$label]] = $true } }
  foreach ($code in [regex]::Matches($ui, '\b(?:ERR_[A-Z_]{2,45}|0x[0-9a-fA-F]{8})\b')) { $seen[$code.Value] = $true }
}
Write-Output "QA_DIAG windows=$($seen.Keys -join '|')"
$events = @(Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-4); Id=1000,1001,1026} -MaxEvents 40 | Where-Object { $_.Message -match 'Sagax\.exe' })
Write-Output "QA_DIAG appCrashEvents=$($events.Count)"
foreach ($event in $events) {
  $codes = @([regex]::Matches($event.Message, '\b0x[0-9a-fA-F]{8}\b') | ForEach-Object { $_.Value })
  Write-Output "QA_DIAG appEvent=$($event.Id) codes=$($codes -join '|')"
}
