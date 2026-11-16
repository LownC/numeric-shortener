$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$container = 'numeric-shortener-m2-postgres'
$exists = & docker exec $container psql -X -At -U shortener_migrator -d numeric_shortener -c "SELECT to_regclass('public.urls') IS NOT NULL"
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect M2 schema' }
if ($exists -eq 't') { throw 'Migration already present; refusing to recreate or reset data' }
$output = Get-Content -LiteralPath 'migrations/0001_urls.sql' -Raw | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U shortener_migrator -d numeric_shortener 2>&1
if ($LASTEXITCODE -ne 0) { throw "Migration failed: $output" }
Write-Output 'PASS: schema migrated as shortener_migrator; app has no DDL/sequence permissions'
