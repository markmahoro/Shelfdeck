Set oWS = WScript.CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")

' 获取脚本所在目录
sScriptDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

' 创建启动快捷方式
sLinkFile = oWS.SpecialFolders("Desktop") & "\启动 ShelfDeck.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = sScriptDir & "\start-shelfdeck.bat"
oLink.WorkingDirectory = sScriptDir
oLink.Description = "一键启动 ShelfDeck 全套服务"
oLink.IconLocation = "shell32.dll,137"
oLink.Save

' 创建关闭快捷方式
sLinkFile = oWS.SpecialFolders("Desktop") & "\关闭 ShelfDeck.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = sScriptDir & "\stop-shelfdeck.bat"
oLink.WorkingDirectory = sScriptDir
oLink.Description = "一键关闭 ShelfDeck 全套服务"
oLink.IconLocation = "shell32.dll,132"
oLink.Save

WScript.Echo "桌面快捷方式创建成功！"
WScript.Echo "- 启动 ShelfDeck.lnk"
WScript.Echo "- 关闭 ShelfDeck.lnk"
