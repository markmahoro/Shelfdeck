@echo off
chcp 65001 >nul
echo ========================================
echo   ShelfDeck 一键关闭
echo ========================================
echo.

echo 正在关闭所有 ShelfDeck 进程...

REM 关闭 Node.js 进程（media-service 和 media-tray-supervisor）
taskkill /FI "WINDOWTITLE eq ShelfDeck-MediaService*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ShelfDeck-Tray*" /T /F >nul 2>&1

REM 关闭 Electron 进程（media-desktop）
taskkill /FI "WINDOWTITLE eq ShelfDeck-Desktop*" /T /F >nul 2>&1

REM 额外清理：关闭可能残留的 node 和 electron 进程
REM 注意：这会关闭所有相关进程，如果有其他项目在运行可能会受影响
echo 清理残留进程...
for /f "tokens=2" %%i in ('tasklist ^| findstr /i "node.exe"') do (
    wmic process where "ProcessId=%%i and CommandLine like '%%emby_third_party%%'" delete >nul 2>&1
)
for /f "tokens=2" %%i in ('tasklist ^| findstr /i "electron.exe"') do (
    wmic process where "ProcessId=%%i and CommandLine like '%%emby_third_party%%'" delete >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo.
echo ========================================
echo   所有服务已关闭
echo ========================================
echo.
echo 按任意键关闭此窗口...
pause >nul
