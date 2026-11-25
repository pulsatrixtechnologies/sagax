param([int]$RootProcess)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# Native Win32 static text in an Electron error box may not expose a UIA Name.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DialogText {
  delegate bool Visit(IntPtr hwnd, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visit visit, IntPtr arg);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr max, StringBuilder buf, uint flags, uint timeout, out IntPtr result);
  public static string Read(int parent) {
    var text = new StringBuilder();
    EnumChildWindows((IntPtr)parent, (hwnd, ignored) => {
      var value = new StringBuilder(8192);
      IntPtr result;
      SendMessageTimeout(hwnd, 13, (IntPtr)value.Capacity, value, 2, 200, out result);
      text.AppendLine(value.ToString());
      return true;
    }, IntPtr.Zero);
    return text.ToString();
  }
}
'@
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
  $nativeMessage = [DialogText]::Read($window.Current.NativeWindowHandle)
  $ui += ' ' + $nativeMessage
  $knownErrors = 'TypeError','ReferenceError','SyntaxError','RangeError','URIError','AggregateError','Error','EACCES','EPERM','ENOENT','EBUSY','EINVAL','MODULE_NOT_FOUND','Uncaught Exception','File URL path','Invalid URL','is not a function','is not defined','before the app is ready','Cannot access','does not provide an export','Failed to get','Unexpected token','Cannot read properties','The specified module could not be found','operation not permitted','Cannot use import'
  foreach ($known in $knownErrors) {
    if ($ui -match [regex]::Escape($known)) { Write-Output "QA_DIAG errorClass=$known" }
  }
  $tracked = @(git ls-files)
  foreach ($frame in [regex]::Matches($ui, '(?i)([a-zA-Z0-9_.-]+\.(?:cjs|mjs|js|node))(?::(\d+):(\d+))?')) {
    $file = $frame.Groups[1].Value
    if ($tracked | Where-Object { $_.EndsWith("/$file", [StringComparison]::OrdinalIgnoreCase) -or $_ -eq $file } | Select-Object -First 1) {
      Write-Output "QA_DIAG frame=$file line=$($frame.Groups[2].Value) column=$($frame.Groups[3].Value)"
    }
  }
  foreach ($relative in [regex]::Matches($ui, '(?i)resources[\\/]app\.asar[\\/]([a-z0-9_./\\-]+)')) {
    $trackPath = $relative.Groups[1].Value.Replace('\','/')
    if ($trackPath -in $tracked) { Write-Output "QA_DIAG source=$trackPath" }
  }
  foreach ($module in [regex]::Matches($ui, '(?i)(?:module|package) [''"](@?[a-zA-Z0-9_./-]+)[''"]')) {
    $name = $module.Groups[1].Value
    if (Select-String -LiteralPath 'pnpm-lock.yaml' -Pattern $name -SimpleMatch -Quiet) { Write-Output "QA_DIAG package=$name" }
  }
  Write-Output "QA_DIAG textChars=$($ui.Length)"
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
