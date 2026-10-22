param(
  [ValidateSet('menu','install','install-no-backup','restore','status')][string]$Action='status',
  [string]$Resources,
  [string]$Store
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  if ($Action -eq 'menu') {
    Write-Host 'Claude Desktop 简体中文补丁'
    Write-Host '[1] 安装汉化并备份（推荐，可一键还原）'
    Write-Host '[2] 安装汉化但不备份（无法一键还原）'
    Write-Host '[0] 退出'
    Write-Host '备份和状态均保存在补丁目录的 .state 中，不额外创建 C 盘目录。'
    $selection = (Read-Host '请选择，直接回车使用 1').Trim()
    switch ($selection) {
      '' { $Action='install' }
      '1' { $Action='install' }
      '2' { $Action='install-no-backup' }
      '0' { exit 0 }
      default { throw '无效选项，未修改任何文件。' }
    }
  }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { throw '需要 Node.js 22 或更新且已加入 PATH。本补丁不会自动安装环境。' }
  $nodeVersion = & $node.Source --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw '需要 Node.js 22 或更新。' }
  $script = Join-Path $PSScriptRoot 'patch.cjs'
  if ($Store -and -not $Resources) { throw '指定 Store 时也需要指定 Resources。' }
  if ($Store) { & $node.Source $script $Action $Resources $Store }
  elseif ($Resources) { & $node.Source $script $Action $Resources }
  else { & $node.Source $script $Action }
  exit $LASTEXITCODE
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }