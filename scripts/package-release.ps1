$ErrorActionPreference='Stop'
function Get-Sha256([string]$Path) {
  $reader = [IO.File]::OpenRead($Path)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash($reader)).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose(); $reader.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseName = "$($package.name)-v$($package.version)"
$outputRoot = Join-Path $projectRoot 'dist'
$zipPath = Join-Path $outputRoot ($releaseName + '.zip')
$hashPath = Join-Path $outputRoot ($releaseName + '.sha256')
& node (Join-Path $PSScriptRoot 'check-release.cjs')
if ($LASTEXITCODE -ne 0) { throw '发布检查未通过。' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fileList = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
# Build directly from an allowlist; no staging directory or personal state enters the ZIP.
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
try {
  $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
  try {
    foreach ($relative in $fileList) {
      $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
      if (!$source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) { throw '文件超出项目目录。' }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$source,($releaseName + '/' + $relative.Replace('\','/')),[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$digest = Get-Sha256 $zipPath
[IO.File]::WriteAllText($hashPath,($digest + '  ' + [IO.Path]::GetFileName($zipPath) + "`n"),[Text.UTF8Encoding]::new($false))
Write-Output "已生成：$zipPath"
Write-Output "校验文件：$hashPath"
$sourceExtras = @('package.json','.gitignore','scripts/check-release.cjs','scripts/package-release.ps1','scripts/release-files.json','tests/patch.test.cjs','tests/ui.test.cjs','tests/launcher.test.cjs')
$sourceZipPath = Join-Path $outputRoot ($releaseName + '-source.zip')
$sourceStream = [IO.File]::Open($sourceZipPath,[IO.FileMode]::Create)
try {
  $sourceZip = [IO.Compression.ZipArchive]::new($sourceStream,[IO.Compression.ZipArchiveMode]::Create,$true)
  try {
    foreach ($relative in (@($fileList) + $sourceExtras)) {
      $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
      if (!$source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) { throw '文件超出项目目录。' }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($sourceZip,$source,($releaseName + '/' + $relative.Replace('\','/')),[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $sourceZip.Dispose() }
} finally { $sourceStream.Dispose() }
$sourceDigest = Get-Sha256 $sourceZipPath
[IO.File]::WriteAllText((Join-Path $outputRoot ($releaseName + '-source.sha256')),($sourceDigest + '  ' + [IO.Path]::GetFileName($sourceZipPath) + "`n"),[Text.UTF8Encoding]::new($false))
Write-Output "源码包：$sourceZipPath"
