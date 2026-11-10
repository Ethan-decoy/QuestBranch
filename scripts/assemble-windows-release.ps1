$ErrorActionPreference = 'Stop'
$qbVersion = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$qbRoot = (Get-Location).Path
$qbApp = Join-Path $qbRoot 'release/win-unpacked'
$qbInstaller = Join-Path $qbRoot "release/QuestBranch-Setup-$qbVersion-x64.exe"
$qbZip = Join-Path $qbRoot "release/QuestBranch-$qbVersion-windows-x64.zip"
$qbInstallResult = Get-Content -LiteralPath artifacts/release-evidence/installer-verification.json -Raw | ConvertFrom-Json
$qbPackageResult = Get-Content -LiteralPath artifacts/release-evidence/package-integrity.json -Raw | ConvertFrom-Json
$qbOmResult = Get-Content -LiteralPath artifacts/release-evidence/session-runtime.stdout.log -Raw | ConvertFrom-Json
$qbCommit = (& git rev-parse HEAD).Trim()
if ($qbInstallResult.version -ne $qbVersion -or $qbPackageResult.version -ne $qbVersion -or $qbInstallResult.sourceCommit -ne $qbCommit -or $qbPackageResult.sourceCommit -ne $qbCommit) { throw 'Acceptance evidence does not match this build' }
foreach ($qbRequired in @('freshInstall','installerUpgrade','savedStorageLocationPreserved','oldPortableJsonImportAndReopen','normalExitAndReopen','uninstallPreservesResearch','installBytesMatch')) {
  if ($qbInstallResult.$qbRequired -ne $true) { throw "Missing installer acceptance: $qbRequired" }
}
if ($qbPackageResult.contentMatchesBuildInputs -ne $true) { throw 'Compiled or license bytes do not match inputs' }
if ($qbOmResult.realOmSdk -ne $true -or $qbOmResult.calls -ne 1) { throw 'Real packaged OM SDK fixture did not pass' }
Copy-Item -LiteralPath docs/windows-trial.md -Destination release/README-TRIAL.md
Copy-Item -LiteralPath docs/release-notes.md -Destination release/RELEASE-NOTES.md
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $qbZip) { throw 'Refuse to overwrite an assembled archive' }
$qbFiles = @(Get-ChildItem -LiteralPath $qbApp -Recurse -File -Force)
if (@($qbFiles | Where-Object { $_.Name -match '\.(?:sqlite|db)(?:-(?:wal|shm))?$' -or $_.Name -in @('auth.json','credentials.json','Preferences') }).Count) { throw 'Data or credentials found in application output' }
$qbArchive = [IO.Compression.ZipFile]::Open($qbZip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($qbFile in $qbFiles) {
    $qbName = 'win-unpacked/' + [IO.Path]::GetRelativePath($qbApp, $qbFile.FullName).Replace([char]92,[char]47)
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($qbArchive, $qbFile.FullName, $qbName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($qbExtra in @(@('Start-QuestBranch.cmd','Start-QuestBranch.cmd'),@('release/README-TRIAL.md','README-TRIAL.md'))) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($qbArchive, (Join-Path $qbRoot $qbExtra[0]), $qbExtra[1], [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $qbArchive.Dispose() }
$qbReadback = [IO.Compression.ZipFile]::OpenRead($qbZip)
try {
  if ($qbReadback.Entries.Count -ne $qbFiles.Count + 2) { throw 'ZIP inventory mismatch' }
  foreach ($qbFile in $qbFiles) {
    $qbName = 'win-unpacked/' + [IO.Path]::GetRelativePath($qbApp, $qbFile.FullName).Replace([char]92,[char]47)
    $qbEntry = $qbReadback.GetEntry($qbName)
    if ($null -eq $qbEntry -or $qbEntry.Length -ne $qbFile.Length) { throw 'ZIP file missing or truncated' }
    $qbStream = $qbEntry.Open()
    try { $qbHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($qbStream)).ToLowerInvariant() } finally { $qbStream.Dispose() }
    if ($qbHash -ne (Get-FileHash -LiteralPath $qbFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'ZIP bytes differ from accepted package' }
  }
} finally { $qbReadback.Dispose() }
$qbVerification = [ordered]@{
  version=$qbVersion; sourceCommit=$qbCommit; platform='windows-x64'; prerelease=$true;
  workflow="https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID";
  installer=$qbInstallResult; package=$qbPackageResult; zipEntries=$qbFiles.Count+2; zipContentMatchesAcceptedPackage=$true;
  om=@{realSdk=$true;fixtureOnly=$true;calls=$qbOmResult.calls;identity=$qbOmResult.identity};
  actualInstallerSignature=(Get-AuthenticodeSignature -LiteralPath $qbInstaller).Status.ToString();
  realProviderCalls=0; automaticInstallOnQuit=$false;
  assets=@(@{name=(Split-Path -Leaf $qbInstaller);sha256=(Get-FileHash -LiteralPath $qbInstaller -Algorithm SHA256).Hash.ToLowerInvariant()},@{name=(Split-Path -Leaf $qbZip);sha256=(Get-FileHash -LiteralPath $qbZip -Algorithm SHA256).Hash.ToLowerInvariant()})
}
$qbVerification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath release/VERIFICATION.json -Encoding utf8
$qbNames = @("QuestBranch-Setup-$qbVersion-x64.exe","QuestBranch-$qbVersion-windows-x64.zip",'README-TRIAL.md','RELEASE-NOTES.md','VERIFICATION.json')
$qbChecksumLines = foreach ($qbName in $qbNames) { (Get-FileHash -LiteralPath (Join-Path 'release' $qbName) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $qbName }
$qbChecksumLines | Set-Content -LiteralPath release/SHA256SUMS.txt -Encoding utf8
Write-Output 'Accepted installer, portable ZIP, notes, verification and checksums assembled.'
