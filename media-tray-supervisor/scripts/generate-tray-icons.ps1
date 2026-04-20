Add-Type -AssemblyName System.Drawing
$assets = Join-Path $PSScriptRoot "..\electron\assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null

function Save-Icon([string]$htmlColor, [string]$fileName) {
  $bmp = New-Object Drawing.Bitmap 16, 16
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $col = [Drawing.ColorTranslator]::FromHtml($htmlColor)
  $g.Clear([Drawing.Color]::Transparent)
  $brush = New-Object Drawing.SolidBrush $col
  $g.FillEllipse($brush, 1, 1, 13, 13)
  $brush.Dispose()
  $g.Dispose()
  $dest = Join-Path $assets $fileName
  $bmp.Save($dest, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Save-Icon "#22c55e" "status-running.png"
Save-Icon "#ef4444" "status-unhealthy.png"
Save-Icon "#9ca3af" "status-stopped.png"
Write-Host "[tray-supervisor] wrote tray icons to $assets"
