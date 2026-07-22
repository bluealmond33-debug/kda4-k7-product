#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$rules = @(
    @{
        Name = "K7 Live UI TCP 5173"
        Protocol = "TCP"
        Port = 5173
        Description = "KDA local LAN demo frontend only"
    },
    @{
        Name = "K7 Live API TCP 8000"
        Protocol = "TCP"
        Port = 8000
        Description = "KDA local LAN demo backend and WebSocket only"
    },
    @{
        Name = "K7 WO Mic UDP 60000"
        Protocol = "UDP"
        Port = 60000
        Description = "WO Mic local LAN audio input only"
    }
)

foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -Action Allow `
        -Protocol $rule.Protocol `
        -LocalPort $rule.Port `
        -Profile Any `
        -Description $rule.Description | Out-Null
}

Write-Host ""
Write-Host "K7 LAN firewall rules are enabled:" -ForegroundColor Green
Get-NetFirewallRule -DisplayName ($rules.Name) |
    ForEach-Object {
        $port = $_ | Get-NetFirewallPortFilter
        [pscustomobject]@{
            Name = $_.DisplayName
            Enabled = $_.Enabled
            Direction = $_.Direction
            Action = $_.Action
            Profile = $_.Profile
            Protocol = $port.Protocol
            LocalPort = $port.LocalPort
        }
    } |
    Format-Table -AutoSize

Write-Host "This window will close in 8 seconds." -ForegroundColor DarkGray
Start-Sleep -Seconds 8
