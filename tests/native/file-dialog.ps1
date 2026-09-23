param(
  [Parameter(Mandatory=$true)][string]$Path,
  [ValidateSet('Open','Save')][string]$Action='Open'
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MatVisionDialogControls {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string value);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@
$targetApp=@(Get-Process -Name 'matvision-studio' -ErrorAction Stop)
if($targetApp.Count -ne 1) { throw 'Native dialog test requires exactly one MatVision Studio process.' }
$processCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetApp[0].Id)
$deadline=[DateTime]::UtcNow.AddSeconds(25)
$dialog=$null
do {
  $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$processCondition)
  foreach($window in $windows) {
    if($window.Current.ClassName -eq '#32770') { $dialog=$window; break }
    $dialogClass=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
    $ownedDialog=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$dialogClass)
    if($ownedDialog) { $dialog=$ownedDialog; break }
  }
  if(-not $dialog) { Start-Sleep -Milliseconds 100 }
} while(-not $dialog -and [DateTime]::UtcNow -lt $deadline)
if(-not $dialog) {
  foreach($window in $windows) {
    Write-Output "WINDOW: $($window.Current.Name) class=$($window.Current.ClassName)"
    $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Select-Object -First 120 | ForEach-Object { Write-Output "ELEMENT: $($_.Current.Name) class=$($_.Current.ClassName) id=$($_.Current.AutomationId)" }
  }
  throw 'The actual Windows file dialog did not open.'
}
$editCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')
$nameEdit=$null
$fieldDeadline=[DateTime]::UtcNow.AddSeconds(10)
do {
  $edits=$dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editCondition)
  foreach($edit in $edits) {
    if($edit.Current.AutomationId -in @('1148','1001') -or $edit.Current.Name -match '^File name') { $nameEdit=$edit; break }
  }
  if(-not $nameEdit) { Start-Sleep -Milliseconds 100 }
} while(-not $nameEdit -and [DateTime]::UtcNow -lt $fieldDeadline)
if(-not $nameEdit) {
  $edits | ForEach-Object { Write-Output "EDIT: $($_.Current.Name) id=$($_.Current.AutomationId)" }
  Write-Output "DIALOG: $($dialog.Current.Name)"
  $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Select-Object -First 120 | ForEach-Object { Write-Output "ELEMENT: $($_.Current.Name) class=$($_.Current.ClassName) id=$($_.Current.AutomationId)" }
  throw 'The filename field was not found in the native dialog.'
}
# Some WebView2 hosts expose classic dialog controls as Custom with no UIA
# Value/Invoke patterns. Operate their observed HWNDs after validating ownership.
$editHandle=[IntPtr]$nameEdit.Current.NativeWindowHandle
[uint32]$ownerId=0
[void][MatVisionDialogControls]::GetWindowThreadProcessId($editHandle,[ref]$ownerId)
if($editHandle -eq [IntPtr]::Zero -or $ownerId -ne $targetApp[0].Id) { throw 'Filename control ownership mismatch.' }
[void][MatVisionDialogControls]::SendMessage($editHandle,0x000C,[IntPtr]::Zero,$Path)
$buttonCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Button')
$buttons=$dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,$buttonCondition)
$commit=$null
foreach($button in $buttons) {
  if($button.Current.AutomationId -eq '1' -or $button.Current.Name -match '^(Open|Save)(\s|$)') { $commit=$button; break }
}
if(-not $commit) { throw "Native $Action button not found." }
$commitHandle=[IntPtr]$commit.Current.NativeWindowHandle
[void][MatVisionDialogControls]::GetWindowThreadProcessId($commitHandle,[ref]$ownerId)
if($commitHandle -eq [IntPtr]::Zero -or $ownerId -ne $targetApp[0].Id) { throw 'Dialog button ownership mismatch.' }
[void][MatVisionDialogControls]::PostMessage($commitHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
Write-Output "Native $Action dialog completed."
