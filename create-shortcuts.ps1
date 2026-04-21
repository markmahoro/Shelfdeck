$projectRoot = "E:\my_project\emby_third_party"
$desktop = [Environment]::GetFolderPath("Desktop")

# 创建启动快捷方式
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$desktop\启动 ShelfDeck.lnk")
$Shortcut.TargetPath = "$projectRoot\start-shelfdeck.bat"
$Shortcut.WorkingDirectory = $projectRoot
$Shortcut.Description = "一键启动 ShelfDeck 全套服务"
$Shortcut.IconLocation = "shell32.dll,137"
$Shortcut.Save()

# 创建关闭快捷方式
$Shortcut = $WshShell.CreateShortcut("$desktop\关闭 ShelfDeck.lnk")
$Shortcut.TargetPath = "$projectRoot\stop-shelfdeck.bat"
$Shortcut.WorkingDirectory = $projectRoot
$Shortcut.Description = "一键关闭 ShelfDeck 全套服务"
$Shortcut.IconLocation = "shell32.dll,132"
$Shortcut.Save()

Write-Host "桌面快捷方式创建成功！" -ForegroundColor Green
Write-Host "- 启动 ShelfDeck.lnk"
Write-Host "- 关闭 ShelfDeck.lnk"
