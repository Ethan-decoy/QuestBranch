param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Run installer acceptance only in a disposable Windows Actions runner' }
if ($env:GITHUB_REPOSITORY -ne 'Ethan-decoy/QuestBranch') { throw 'Unexpected distribution repository' }
$qbRoot = (Get-Location).Path
$qbVersion = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$qbEvidence = Join-Path $qbRoot 'artifacts/release-evidence'
New-Item -ItemType Directory -Path $qbEvidence -Force | Out-Null
$qbTemporary = Join-Path $env:RUNNER_TEMP ('questbranch-installer-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qbTemporary | Out-Null
$qbPreviousVersion = '0.3.0-dev.5'
$qbPreviousDigest = '6615a9b76060ca6416a8e12467e730a2a62e2e4d982429b7fb15120d2ad756eb'
$qbPreviousInstallerDigest = '20bcba72ca8b4cc083348385a80894b3008e40d207b72b0ce57f6057726697bd'
$qbPreviousArchive = Join-Path $qbTemporary 'previous.zip'
$qbPreviousApp = Join-Path $qbTemporary 'previous'
function Hash-QbFile([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Wait-Qb([scriptblock]$Condition) {
  $qbDeadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $qbDeadline) { if (& $Condition) { return }; Start-Sleep -Milliseconds 200 }
  throw 'Installer acceptance condition timed out'
}
function Install-Qb([string]$Setup, [string]$Directory, [string]$ExpectedVersion) {
  if (-not ([IO.Path]::GetFullPath($Directory)).StartsWith($qbTemporary + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target leaves disposable test root' }
  # NSIS requires /D last, without quotes, including when the path contains spaces.
  $qbProcess = Start-Process -FilePath $Setup -ArgumentList "/S /currentuser /D=$Directory" -WindowStyle Hidden -Wait -PassThru
  if ($qbProcess.ExitCode -ne 0) { throw "Installer failed: $($qbProcess.ExitCode)" }
  Wait-Qb { Test-Path -LiteralPath (Join-Path $Directory 'QuestBranch.exe') }
  $qbActualVersion = (Get-Item -LiteralPath (Join-Path $Directory 'QuestBranch.exe')).VersionInfo.FileVersion
  if ($qbActualVersion -ne $ExpectedVersion) { throw "Installed application version mismatch: $qbActualVersion" }
}
function Remove-QbInstallation([string]$Directory) {
  if (-not ([IO.Path]::GetFullPath($Directory)).StartsWith($qbTemporary + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target leaves disposable test root' }
  $qbUninstallers = @(Get-ChildItem -LiteralPath $Directory -File -Filter 'Uninstall*.exe')
  if ($qbUninstallers.Count -ne 1) { throw 'Expected one generated uninstaller' }
  $qbProcess = Start-Process -FilePath $qbUninstallers[0].FullName -ArgumentList '/S /currentuser' -WindowStyle Hidden -Wait -PassThru
  if ($qbProcess.ExitCode -ne 0) { throw 'Uninstaller failed' }
  Wait-Qb { -not (Test-Path -LiteralPath (Join-Path $Directory 'QuestBranch.exe')) }
}
function Invoke-QbResearch([string]$Directory, [string]$Name, [string]$Reopen = '', [switch]$SavedLocation) {
  $qbArguments = @('scripts/verify-branching-mcp.mjs', "--package-root=$Directory")
  if ($Reopen) { $qbArguments += "--reopen=$Reopen" }
  if ($SavedLocation) { $qbArguments += '--saved-location' }
  $qbLog = Join-Path $qbEvidence "$Name.log"
  & node @qbArguments *> $qbLog
  if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $qbLog -Tail 30; throw "Research acceptance failed: $Name" }
  $qbOutcome = Get-Content -LiteralPath $qbLog -Tail 1 | ConvertFrom-Json
  $qbRecord = Get-Content -LiteralPath (Join-Path $qbOutcome.folder 'result.json') -Raw | ConvertFrom-Json
  if (-not $qbOutcome.success -or -not $qbRecord.normalExit) { throw 'Research test did not finish normally' }
  Copy-Item -LiteralPath (Join-Path $qbOutcome.folder 'result.json') -Destination (Join-Path $qbEvidence "$Name.result.json")
  return $qbOutcome.folder
}
function Run-QbElectronCheck([string]$Script, [string[]]$Arguments, [string]$Name) {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $qbArgumentLine = (@($Script) + $Arguments | ForEach-Object { if ($_.Contains('"')) { throw 'Unexpected quote in owned test argument' }; '"' + $_ + '"' }) -join ' '
  $qbProcess = Start-Process -FilePath (Join-Path $qbRoot 'node_modules/electron/dist/electron.exe') -ArgumentList $qbArgumentLine -WorkingDirectory $qbRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $qbEvidence "$Name.stdout.log") -RedirectStandardError (Join-Path $qbEvidence "$Name.stderr.log")
  if ($qbProcess.ExitCode -ne 0) { Get-Content -LiteralPath (Join-Path $qbEvidence "$Name.stderr.log") -Tail 30; throw "Electron acceptance failed: $Name" }
  $qbLastLine = Get-Content -LiteralPath (Join-Path $qbEvidence "$Name.stdout.log") -Tail 1
  if ($Script -like '*conversation*') {
    if ($qbLastLine -notmatch '^Conversation actions verified \(14 cases\): (.+)$') { throw 'Missing conversation acceptance record' }
    $qbResultFolder = $Matches[1]
  } else {
    $qbResult = $qbLastLine | ConvertFrom-Json
    if ($qbResult.cases -ne 12 -or $qbResult.issues.Count) { throw 'Graph acceptance count or issues mismatch' }
    $qbResultFolder = $qbResult.folder
  }
  $qbResultDirectory = [IO.Path]::GetFullPath($qbResultFolder)
  if (-not $qbResultDirectory.StartsWith((Join-Path $qbRoot 'artifacts') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected acceptance result directory' }
  $qbDestination = Join-Path $qbEvidence $Name
  New-Item -ItemType Directory -Path $qbDestination | Out-Null
  Get-ChildItem -LiteralPath $qbResultDirectory -File | Where-Object { $_.Name -eq 'result.json' -or $_.Extension -eq '.png' } | Copy-Item -Destination $qbDestination
}

$qbPriorRegistrations = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'QuestBranch' })
if ($qbPriorRegistrations.Count) { throw 'Disposable runner already has a QuestBranch installation' }
$qbDefaultProfile = Join-Path $env:APPDATA 'questbranch'
if (Test-Path -LiteralPath $qbDefaultProfile) { throw 'Disposable runner already has a QuestBranch profile' }
New-Item -ItemType Directory -Path $qbDefaultProfile | Out-Null
$qbDefaultMarker = Join-Path $qbDefaultProfile 'installer-acceptance-marker.txt'
[Guid]::NewGuid().ToString() | Set-Content -LiteralPath $qbDefaultMarker -Encoding utf8
$qbDefaultMarkerHash = Hash-QbFile $qbDefaultMarker
Invoke-WebRequest -Uri "https://github.com/Ethan-decoy/QuestBranch/releases/download/v$qbPreviousVersion/QuestBranch-$qbPreviousVersion-windows-x64.zip" -OutFile $qbPreviousArchive
if ((Hash-QbFile $qbPreviousArchive) -ne $qbPreviousDigest) { throw 'Published predecessor archive checksum mismatch' }
Expand-Archive -LiteralPath $qbPreviousArchive -DestinationPath $qbPreviousApp
$qbPreviousInstaller = Join-Path $qbTemporary 'previous-setup.exe'
Invoke-WebRequest -Uri "https://github.com/Ethan-decoy/QuestBranch/releases/download/v$qbPreviousVersion/QuestBranch-Setup-$qbPreviousVersion-x64.exe" -OutFile $qbPreviousInstaller
if ((Hash-QbFile $qbPreviousInstaller) -ne $qbPreviousInstallerDigest) { throw 'Published predecessor installer checksum mismatch' }
$qbUpgradeDirectory = Join-Path $qbTemporary '升级验收 QuestBranch'
Install-Qb $qbPreviousInstaller $qbUpgradeDirectory $qbPreviousVersion
$qbUpgradeStudy = Invoke-QbResearch $qbUpgradeDirectory 'predecessor-research'
$qbPointer = Join-Path $qbUpgradeStudy 'profile/storage-location.json'
$qbResearchPath = Join-Path $qbUpgradeStudy 'research'
@{version=1;directory=$qbResearchPath} | ConvertTo-Json | Set-Content -LiteralPath $qbPointer -Encoding utf8
$qbPointerHash = Hash-QbFile $qbPointer
Install-Qb (Resolve-Path -LiteralPath $Installer).Path $qbUpgradeDirectory $qbVersion
if ((Hash-QbFile (Join-Path $qbUpgradeDirectory 'resources/app.asar')) -ne (Hash-QbFile 'release/win-unpacked/resources/app.asar')) { throw 'Upgrade installed bytes differ from final build' }
$null = Invoke-QbResearch $qbUpgradeDirectory 'upgrade-reopen' $qbUpgradeStudy -SavedLocation
if ((Hash-QbFile $qbPointer) -ne $qbPointerHash) { throw 'Upgrade changed saved storage location' }
Run-QbElectronCheck 'scripts/verify-conversation-actions.mjs' @("--package-root=$qbUpgradeDirectory") 'installed-conversation'
Run-QbElectronCheck 'scripts/verify-graph-toolbar.mjs' @("--package-root=$qbUpgradeDirectory",'--theme=light') 'installed-graph-light'
Run-QbElectronCheck 'scripts/verify-graph-toolbar.mjs' @("--package-root=$qbUpgradeDirectory",'--theme=dark') 'installed-graph-dark'
Remove-QbInstallation $qbUpgradeDirectory
if (-not (Test-Path -LiteralPath (Join-Path $qbResearchPath 'research.sqlite')) -or (Hash-QbFile $qbPointer) -ne $qbPointerHash -or (Hash-QbFile $qbDefaultMarker) -ne $qbDefaultMarkerHash) { throw 'Uninstall removed research or profile content' }

$qbFreshDirectory = Join-Path $qbTemporary 'Fresh installation QuestBranch'
Install-Qb (Resolve-Path -LiteralPath $Installer).Path $qbFreshDirectory $qbVersion
if ((Hash-QbFile (Join-Path $qbFreshDirectory 'resources/app.asar')) -ne (Hash-QbFile 'release/win-unpacked/resources/app.asar')) { throw 'Fresh install bytes differ from final build' }
$qbFreshStudy = Invoke-QbResearch $qbFreshDirectory 'fresh-installed-research'
$null = Invoke-QbResearch $qbFreshDirectory 'fresh-installed-reopen' $qbFreshStudy
$qbPortableStudy = Invoke-QbResearch (Join-Path $qbPreviousApp 'win-unpacked') 'old-portable-research'
$qbBackup = Join-Path $qbPortableStudy 'research.questbranch.json'
& node scripts/verify-branching-mcp.mjs "--package-root=$qbFreshDirectory" "--restore=$qbBackup" *> (Join-Path $qbEvidence 'portable-import.log')
if ($LASTEXITCODE -ne 0) { throw 'Portable research import failed' }
$qbImportedStudy = (Get-Content -LiteralPath (Join-Path $qbEvidence 'portable-import.log') -Tail 1 | ConvertFrom-Json).folder
$null = Invoke-QbResearch $qbFreshDirectory 'portable-import-reopen' $qbImportedStudy
Remove-QbInstallation $qbFreshDirectory
if (-not (Test-Path -LiteralPath (Join-Path $qbFreshStudy 'research/research.sqlite')) -or (Hash-QbFile $qbDefaultMarker) -ne $qbDefaultMarkerHash) { throw 'Uninstall removed research or profile content' }
$qbRemaining = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'QuestBranch' })
if ($qbRemaining.Count) { throw 'Uninstall registration remains' }

$qbEvidenceRecord = [ordered]@{
  version=$qbVersion; sourceCommit=(& git rev-parse HEAD).Trim(); platform='win32/x64';
  workflowRun=$env:GITHUB_RUN_ID; fixtureOnly=$true; realModelRequests=0;
  freshInstall=$true; customInstallPaths=$true; installBytesMatch=$true;
  previousVersion=$qbPreviousVersion; previousZipSha256=$qbPreviousDigest; predecessorInstallerSha256=$qbPreviousInstallerDigest; predecessorInstaller='Published NSIS installer';
  installerUpgrade=$true; reportsConversationsAndOriginsPreserved=$true; savedStorageLocationPreserved=$true;
  oldPortableJsonImportAndReopen=$true; normalExitAndReopen=$true; uninstallPreservesResearch=$true;
  conversationCases=14; branchingCases=15; lightGraphCases=12; darkGraphCases=12;
  installerSignature=(Get-AuthenticodeSignature -LiteralPath $Installer).Status.ToString()
}
$qbEvidenceRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $qbEvidence 'installer-verification.json') -Encoding utf8
Write-Output 'Windows install, upgrade, portable import, research, and uninstall acceptance passed.'
