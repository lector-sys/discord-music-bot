# Registers the bot as a Windows scheduled task that starts at logon and
# restarts itself if it dies. Run once:  powershell -ExecutionPolicy Bypass -File install-autostart.ps1
# Undo with:  Unregister-ScheduledTask -TaskName DiscordMusicBot -Confirm:$false

$ErrorActionPreference = 'Stop'
$dir  = $PSScriptRoot
$node = (Get-Command node).Source
$name = 'DiscordMusicBot'
$me   = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $dir `
  -Argument ('/c ""{0}" --env-file=.env index.js >> "{1}\bot.log" 2>&1"' -f $node, $dir)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $me

# Laptop defaults stop a task on battery; a bot that dies when you unplug is not "constant".
# MultipleInstances IgnoreNew stops a second copy from double-answering every command.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# S4U: no console window, no stored password. Falls back if the account lacks the right.
try {
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output 'Registered (S4U, no visible window).'
} catch {
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output 'Registered (Interactive, a console window will be visible).'
}

Start-ScheduledTask -TaskName $name
Write-Output "Started. Logs: $dir\bot.log"
