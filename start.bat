@echo off
cd /d "%~dp0"
echo ================================
echo   SFE 辖区分配系统 启动中...
echo ================================
echo.

:: 检查 node_modules 是否存在，不存在则安装
if not exist "node_modules" (
    echo 首次运行，正在安装依赖...
    call npm install
    echo.
)

:: 检查示例数据是否存在
if not exist "public\sample-hospitals.xlsx" (
    echo 生成示例数据...
    node scripts\generate-sample-data.js
    echo.
)

:: 3秒后打开浏览器
start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

:: 启动开发服务器
echo 启动服务器...
echo 浏览器将自动打开 http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.
call npm run dev
