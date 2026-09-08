$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Dreammaker\Pictures\cf-control-mcp-'

# Load .env into this PowerShell process.
Get-Content -LiteralPath '.\.env' | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name = $line.Substring(0,$idx).Trim()
    $value = $line.Substring($idx+1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1,$value.Length-2)
    }
    Set-Item -Path "env:$name" -Value $value
}

if ([string]::IsNullOrWhiteSpace($env:GATEWAY_AUTH_TOKEN)) { throw 'GATEWAY_AUTH_TOKEN missing in .env' }
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) { throw 'CLOUDFLARE_API_TOKEN missing in .env' }
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ACCOUNT_ID)) { throw 'CLOUDFLARE_ACCOUNT_ID missing in .env' }

# Keep local compatibility alias aligned.
$env:PROVIDER_GATEWAY_AUTH_TOKEN = $env:GATEWAY_AUTH_TOKEN

# IMPORTANT: the Worker guard compares the bearer token byte-for-byte with this Worker secret.
# Sync the existing local value into production without echoing it.
$env:GATEWAY_AUTH_TOKEN | npx wrangler secret put GATEWAY_AUTH_TOKEN
if ($LASTEXITCODE -ne 0) { throw 'wrangler secret put GATEWAY_AUTH_TOKEN failed' }

# Verify the client auth boundary.
$headers = @{ Authorization = "Bearer $env:GATEWAY_AUTH_TOKEN"; Accept = 'application/json' }
$r = Invoke-WebRequest -Uri 'https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/models' -Headers $headers -Method GET -TimeoutSec 30
"/v1/models PASS HTTP $($r.StatusCode)"

# Run the existing production verifier with the aligned token.
$env:PRODUCTION_BASE_URL = 'https://cf-control-mcp.amin-chinisaz-edu.workers.dev'
$env:MCP_BASE_URL = $env:PRODUCTION_BASE_URL
python scripts\verify_production.py
exit $LASTEXITCODE
