function Import-M2LocalEnv {
    $file = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
    if (-not (Test-Path -LiteralPath $file)) { throw 'Private .env missing; prepare the dedicated local DB first' }
    foreach ($line in Get-Content -LiteralPath $file) {
        if ($line -match '^(DATABASE_URL|PUBLIC_BASE_URL)=(.+)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}
