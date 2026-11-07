param([Parameter(Mandatory=$true)][string]$CandidateRunId)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -ne 'Ethan-decoy/QuestBranch' -or $env:GITHUB_REF_TYPE -ne 'tag') { throw 'Publish only from the authorized distribution tag workflow' }
$qbVersion = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$qbTag = "v$qbVersion"
if ($env:GITHUB_REF_NAME -ne $qbTag -or $qbVersion -notmatch '^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$') { throw 'Tag must match the prerelease package version' }
$qbCommit = (& git rev-parse HEAD).Trim()
$qbVerification = Get-Content -LiteralPath release/VERIFICATION.json -Raw | ConvertFrom-Json
if ($qbVerification.sourceCommit -ne $qbCommit -or $qbVerification.version -ne $qbVersion -or $qbVerification.workflowRun -ne $CandidateRunId) { throw 'Downloaded artifacts are not the accepted candidate for this tag' }
foreach ($qbPlatform in @('windows-x64','macos-arm64','macos-x64','linux-x64')) {
  if ($qbVerification.platforms.$qbPlatform.sourceCommit -ne $qbCommit) { throw 'Missing accepted native platform' }
}
$qbExpectedFiles = @("QuestBranch-Setup-$qbVersion-x64.exe","QuestBranch-$qbVersion-windows-x64.zip","QuestBranch-$qbVersion-macos-arm64.dmg","QuestBranch-$qbVersion-macos-x64.dmg","QuestBranch-$qbVersion-linux-x64.deb","QuestBranch-$qbVersion-linux-x64.AppImage",'README-TRIAL.md','RELEASE-NOTES.md','VERIFICATION.json')
$qbChecksums = @{}
foreach ($qbLine in Get-Content -LiteralPath release/SHA256SUMS.txt) {
  if ($qbLine -notmatch '^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$') { throw 'Invalid checksum manifest' }
  if ($qbExpectedFiles -notcontains $Matches[2] -or $qbChecksums.ContainsKey($Matches[2])) { throw 'Unexpected or duplicate release asset' }
  $qbChecksums[$Matches[2]] = $Matches[1]
}
if ($qbChecksums.Count -ne $qbExpectedFiles.Count) { throw 'Missing release checksum' }
foreach ($qbName in $qbExpectedFiles) {
  if ((Get-FileHash -LiteralPath (Join-Path 'release' $qbName) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $qbChecksums[$qbName]) { throw "Candidate asset checksum mismatch: $qbName" }
}
$qbExisting = & gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$qbTag" 2>&1
if ($LASTEXITCODE -eq 0) {
  $qbRelease = ($qbExisting -join "`n") | ConvertFrom-Json
  if (-not $qbRelease.draft) { throw 'Refuse to change an already published release' }
  if ($qbRelease.target_commitish -ne $qbCommit) { throw 'Existing draft targets another source commit' }
} else {
  if (($qbExisting -join "`n") -notmatch '404') { throw 'Unable to check existing release' }
  & gh release create $qbTag --verify-tag --draft --prerelease --latest=false --target $qbCommit --title "QuestBranch $qbTag" --notes-file release/RELEASE-NOTES.md
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create release draft' }
}
$qbAssets = @($qbExpectedFiles | ForEach-Object { Join-Path 'release' $_ }) + @('release/SHA256SUMS.txt')
& gh release upload $qbTag @qbAssets --clobber
if ($LASTEXITCODE -ne 0) { throw 'Release draft upload failed' }
$qbReadback = Join-Path $env:RUNNER_TEMP ('qb-release-readback-' + [Guid]::NewGuid().ToString('N'))
& gh release download $qbTag --dir $qbReadback
if ($LASTEXITCODE -ne 0) { throw 'Unable to download uploaded draft assets' }
if (@(Get-ChildItem -LiteralPath $qbReadback -File).Count -ne $qbAssets.Count) { throw 'Remote draft has unexpected assets' }
foreach ($qbAsset in $qbAssets) {
  $qbName = Split-Path -Leaf $qbAsset
  if ((Get-FileHash -LiteralPath $qbAsset -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $qbReadback $qbName) -Algorithm SHA256).Hash) { throw "Remote draft bytes differ: $qbName" }
}
& gh release edit $qbTag --draft=false --prerelease --latest=false
if ($LASTEXITCODE -ne 0) { throw 'Release publication failed' }
& gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$qbTag" --jq '{url: .html_url, draft: .draft, prerelease: .prerelease, published_at: .published_at}'
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify published release metadata' }
