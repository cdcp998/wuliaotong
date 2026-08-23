Add-Type -AssemblyName System.Drawing
$src = @(
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Dashboard.png";        Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_dashboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-MapWorkbench3.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_map.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Menus3.png";           Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_menus.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Users.png";            Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_users.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_dashboard.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_dashboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_cable_map.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_map.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_system_menus.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_menus.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_system_users.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_users.jpg" }
)
foreach ($s in $src) {
  $img = [System.Drawing.Image]::FromFile($s.In)
  $w = 1200; $h = [int]($img.Height * ($w / $img.Width))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]82)
  $bmp.Save($s.Out, $enc, $ep)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  "{0}  ->  {1}  ({2} KB)" -f (Split-Path $s.In -Leaf), (Split-Path $s.Out -Leaf), [int]((Get-Item $s.Out).Length / 1KB)
}
