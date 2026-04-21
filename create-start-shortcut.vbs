Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\启动 ShelfDeck.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = oWS.ExpandEnvironmentStrings("%~dp0") & "start-shelfdeck.bat"
oLink.WorkingDirectory = oWS.ExpandEnvironmentStrings("%~dp0")
oLink.Description = "一键启动 ShelfDeck 全套服务"
oLink.IconLocation = "shell32.dll,137"
oLink.Save
