param([ValidateSet('dev', 'release')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot/local-env.ps1"
Import-M2LocalEnv
$env:PATH = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:PATH
$env:IP = '127.0.0.1'
if ($Mode -eq 'dev') {
    # Explicit loopback/debug-only exception. Release binaries ignore this flag.
    $env:APP_ENV = 'local'
    $env:CREATE_URLS_ENABLED = 'true'
    $env:ALLOW_INSECURE_LOCAL_CREATE = 'true'
    $env:PUBLIC_BASE_URL = 'http://127.0.0.1:18080'
    & dx serve --web --port 18080 --addr 127.0.0.1 --open false --interactive false
} else {
    $env:APP_ENV = 'production'
    $env:CREATE_URLS_ENABLED = 'false'
    Remove-Item Env:ALLOW_INSECURE_LOCAL_CREATE -ErrorAction SilentlyContinue
    $env:PORT = '18081'
    $env:PUBLIC_BASE_URL = 'http://127.0.0.1:18083'
    & '.\target\dx\numeric-shortener\release\web\server.exe'
}
exit $LASTEXITCODE
