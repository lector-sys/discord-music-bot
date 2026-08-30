# Restarts the bot cleanly.  Usage:  powershell -ExecutionPolicy Bypass -File restart.ps1
#
# Stop-ScheduledTask alone is not enough: the task runs `cmd.exe /c node ...`, and
# Windows terminates only the cmd wrapper, leaving node orphaned. The orphan keeps
# its Discord session and its lock on bot.log, so starting the task again gives you
# two bots answering every command. Kill the orphan before restarting.

$ErrorActionPreference = 'Stop'
$name = 'DiscordMusicBot'
$log  = Join-Path $PSScriptRoot 'bot.log'

# Matches this bot specifically, not every node process on the machine.
$mine = { $_.CommandLine -like '*--env-file=.env*' -and $_.CommandLine -like '*index.js*' }

try { Stop-ScheduledTask -TaskName $name } catch { }
Start-Sleep -Seconds 1

$orphans = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object $mine
foreach ($p in $orphans) {
  Write-Output "killing orphaned node $($p.ProcessId)"
  try { Stop-Process -Id $p.ProcessId -Force } catch { }
}
Start-Sleep -Seconds 1

Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 8

$state = (Get-ScheduledTask -TaskName $name).State
$count = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object $mine).Count
Write-Output "task: $state | bot processes: $count"
if ($count -ne 1) { Write-Warning "expected exactly 1 bot process, found $count" }
if (Test-Path $log) { Get-Content $log -Tail 5 }
