[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$HelpOnly,
  [switch]$PortableNode,
  [string]$BootstrapHome = (Join-Path $env:LOCALAPPDATA 'K3CommanderBootstrap')
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'This launcher currently requires Windows x64 and 64-bit PowerShell.'
}
if (-not [IO.Path]::IsPathRooted($BootstrapHome)) { throw 'BootstrapHome must be absolute.' }
$nodeVersion = '24.15.0'
$nodeHash = 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62'
$packageHash = 'ac9f75d191c0c3ac29c21fb8deffbe333b40a21b40ee7077e1abb90f6534718a'
$packageUrl = 'https://github.com/keithscott234/k3-commander/releases/download/v0.1.2/t3forgeworks-k3-commander-0.1.2.tgz'
$priorPath = $env:PATH
$priorProgress = $ProgressPreference
$priorTls = [Net.ServicePointManager]::SecurityProtocol
$lock = $null
$stage = $null
function Get-VerifiedDownload($Url, $Destination, $Expected) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 120
  if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
    throw 'Download integrity check failed; nothing from that download was executed.'
  }
}
try {
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Path $BootstrapHome -Force | Out-Null
  $lock = [IO.File]::Open((Join-Path $BootstrapHome 'bootstrap.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $node = $null
  if (-not $PortableNode) {
    $candidate = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($candidate -and ((& $candidate.Source --version) -match '^v24\.')) {
      $npmCandidate = Join-Path (Split-Path $candidate.Source) 'node_modules/npm/bin/npm-cli.js'
      if (Test-Path -LiteralPath $npmCandidate) { $node = $candidate.Source; $npm = $npmCandidate }
    }
  }
  if (-not $node) {
    $runtime = Join-Path $BootstrapHome ('node-v'+$nodeVersion+'-win-x64')
    if (-not (Test-Path -LiteralPath $runtime)) {
      Write-Host 'Preparing a private Node.js runtime for K3 Commander...'
      $stage = Join-Path $BootstrapHome ('.stage-'+[guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $stage | Out-Null
      $zip = Join-Path $stage 'node.zip'
      Get-VerifiedDownload ('https://nodejs.org/dist/v'+$nodeVersion+'/node-v'+$nodeVersion+'-win-x64.zip') $zip $nodeHash
      Expand-Archive -LiteralPath $zip -DestinationPath $stage
      Move-Item -LiteralPath (Join-Path $stage ('node-v'+$nodeVersion+'-win-x64')) -Destination $runtime
    }
    $node = Join-Path $runtime 'node.exe'
    $npm = Join-Path $runtime 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $npm)) { throw 'Private Node runtime is incomplete; inspect the bootstrap folder.' }
    if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5') { throw 'Private Node binary integrity check failed.' }
  }
  $package = Join-Path $BootstrapHome 'commander-0.1.2.tgz'
  if (-not (Test-Path -LiteralPath $package)) {
    $partial = Join-Path $BootstrapHome ('download-'+[guid]::NewGuid().ToString('N')+'.tgz')
    try { Get-VerifiedDownload $packageUrl $partial $packageHash; Move-Item -LiteralPath $partial -Destination $package }
    finally { if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force } }
  }
  if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $packageHash) { throw 'Cached launcher integrity check failed.' }
  $env:PATH = (Split-Path $node)+[IO.Path]::PathSeparator+$priorPath
  $cliArgs = @('remote')
  if ($HelpOnly) { $cliArgs = @('--help') } elseif ($Check) { $cliArgs += '--check' }
  $lock.Dispose(); $lock = $null
  & $node $npm exec --yes "--package=$package" -- k3-commander @cliArgs
  if ($LASTEXITCODE -ne 0) { throw "Commander exited with status $LASTEXITCODE." }
} finally {
  if ($lock) { $lock.Dispose() }
  if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
  $env:PATH = $priorPath
  $ProgressPreference = $priorProgress
  [Net.ServicePointManager]::SecurityProtocol = $priorTls
}
