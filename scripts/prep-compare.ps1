Add-Type -AssemblyName System.Drawing
$src = @(
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Dashboard.png";        Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_dashboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-MapWorkbench3.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_map.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Menus3.png";           Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_menus.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/01-Users.png";            Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_users.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-Suppliers.png";     Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_suppliers.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-Plans.png";         Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_plans.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-PurchaseIn.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_purchasein.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-Warehouses.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_warehouses.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-HistoryPrice.png";  Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_historyprice.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-Transfers.png";     Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_transfers.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-OtherIo.png";       Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_otherio.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-TaskBoard.png";     Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_taskboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-TaskList.png";      Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_tasklist.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-MapCache.png";      Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_mapcache.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-Logs.png";          Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_logs.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/design-ref/op/01-CableFaults.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/j_faults.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_dashboard.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_dashboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_cable_map.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_map.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_system_menus.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_menus.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_system_users.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_users.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_suppliers.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_suppliers.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_purchase-plans.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_plans.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_purchase-in.png";  Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_purchasein.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_warehouses.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_warehouses.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_history-price.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_historyprice.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_transfers.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_transfers.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_other-io.png";     Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_otherio.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_task_board.png";   Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_taskboard.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_task_list.png";    Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_tasklist.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_cable_cache.png";  Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_mapcache.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_system_logs.png";  Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_logs.jpg" },
  @{ In = "G:/wuliaotong_dev/AI开发文档/screenshots/desktop_1440_cable_faults.png"; Out = "G:/wuliaotong_dev/AI开发文档/design-ref/a_faults.jpg" }
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
