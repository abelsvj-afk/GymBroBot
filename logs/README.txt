Use run_bot.ps1 to start the bot detached (PowerShell):

.\run_bot.ps1 -Port 3001

Then tail stdout/err logs:

Get-Content .\logs\bot.out.log -Tail 100 -Wait
Get-Content .\logs\bot.err.log -Tail 100 -Wait

If you need to stop the bot, find the node process and kill it:

Get-Process node | Select-Object Id,ProcessName
Stop-Process -Id <id> -Force
