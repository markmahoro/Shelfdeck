@echo off
chcp 65001 >nul
echo ========================================
echo   ShelfDeck 一键启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 启动 media-service...
start "ShelfDeck-MediaService" cmd /k "cd media-service && npm start"
timeout /t 3 /nobreak >nul

echo [2/3] 启动 media-tray-supervisor...
start "ShelfDeck-Tray" cmd /k "cd media-tray-supervisor && npm start"
timeout /t 2 /nobreak >nul

echo [3/3] 启动 media-desktop...
start "ShelfDeck-Desktop" cmd /k "cd media-desktop && npm run dev"

echo.
echo ========================================
echo   所有服务已启动
echo ========================================
echo   - media-service: http://127.0.0.1:18080
echo   - media-tray-supervisor: 系统托盘
echo   - media-desktop: Electron 开发模式
echo.
echo 按任意键关闭此窗口...
pause >nul
