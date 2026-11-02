# Windows entry point for the root compose.yaml with Docker Desktop (deploy/local/README.md).
# Arguments go to docker compose verbatim; no arguments runs ps.
[string[]]$ComposeArgs = @(if ($args.Count) { $args } else { 'ps' })
$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) {
    $dockerPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
}
if (-not (Test-Path -LiteralPath $dockerPath)) {
    throw 'Docker CLI was not found. Install Docker Desktop and add docker to PATH.'
}
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
& $dockerPath compose --project-directory $repository -f (Join-Path $repository 'compose.yaml') @ComposeArgs
exit $LASTEXITCODE
