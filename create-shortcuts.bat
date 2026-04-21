@echo off
chcp 65001 >nul
echo 正在创建桌面快捷方式...

set SCRIPT_DIR=%~dp0
set DESKTOP=%USERPROFILE%\Desktop

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\启动 ShelfDeck.lnk'); $s.TargetPath = '%SCRIPT_DIR%start-shelfdeck.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = '一键启动 ShelfDeck 全套服务'; $s.IconLocation = 'shell32.dll,137'; $s.Save()"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\关闭 ShelfDeck.lnk'); $s.TargetPath = '%SCRIPT_DIR%stop-shelfdeck.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = '一键关闭 ShelfDeck 全套服务'; $s.IconLocation = 'shell32.dll,132'; $s.Save()"

echo.
echo 桌面快捷方式创建成功！
echo - 启动 ShelfDeck.lnk
echo - 关闭 ShelfDeck.lnk
echo.
pause
