$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$container = 'numeric-shortener-m2-postgres'
$volume = 'numeric-shortener-m2-pgdata'
$image = 'postgres:17.11-bookworm'
foreach ($file in @('.env', '.env.db', '.env.migration')) {
    if (Test-Path -LiteralPath $file) { throw "Refusing to overwrite existing $file" }
}
$existing = & docker ps -a --filter "name=^/$container`$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker engine unavailable' }
if ($existing) { throw 'Dedicated container already exists; inspect and reuse it instead of resetting it' }
$existingVolume = & docker volume ls --filter "name=^$volume`$" --format '{{.Name}}'
if ($existingVolume) { throw 'Dedicated volume already exists; refusing to overwrite its data' }
if (Get-NetTCPConnection -LocalPort 15432 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 15432 is in use' }
function New-LocalPassword { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) }
$admin = New-LocalPassword
$migrator = New-LocalPassword
$app = New-LocalPassword
Set-Content -LiteralPath '.env.db' -Encoding utf8NoBOM -Value "POSTGRES_USER=m2_admin`nPOSTGRES_PASSWORD=$admin`nPOSTGRES_DB=postgres"
Set-Content -LiteralPath '.env' -Encoding utf8NoBOM -Value "DATABASE_URL=postgresql://shortener_app:$app@127.0.0.1:15432/numeric_shortener`nPUBLIC_BASE_URL=http://127.0.0.1:18080"
Set-Content -LiteralPath '.env.migration' -Encoding utf8NoBOM -Value "MIGRATION_DATABASE_URL=postgresql://shortener_migrator:$migrator@127.0.0.1:15432/numeric_shortener"
& docker volume create --label 'project=numeric-shortener-m2' $volume | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Volume creation failed' }
& docker run --detach --name $container --label 'project=numeric-shortener-m2' --env-file .env.db --publish '127.0.0.1:15432:5432' --mount "type=volume,source=$volume,target=/var/lib/postgresql/data" $image | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Container startup failed; private config and volume retained for inspection' }
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & docker exec $container pg_isready -U m2_admin -d postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Dedicated PostgreSQL did not become ready' }
$bootstrap = @"
CREATE ROLE shortener_migrator LOGIN PASSWORD '$migrator' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE shortener_app LOGIN PASSWORD '$app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE DATABASE numeric_shortener OWNER shortener_migrator;
REVOKE ALL ON DATABASE numeric_shortener FROM PUBLIC;
GRANT CONNECT ON DATABASE numeric_shortener TO shortener_migrator, shortener_app;
\connect numeric_shortener
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO shortener_migrator;
"@
# Pipe private role passwords via stdin; never print SQL or put passwords in command arguments.
$output = $bootstrap | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U m2_admin -d postgres 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Role bootstrap failed; inspect isolated DB locally without printing private configuration' }
Write-Output 'PASS: isolated PostgreSQL, private local config, admin/migrator/app separation created'
Write-Output 'Next: scripts/migrate-local-db.ps1 (does not run in application startup)'
