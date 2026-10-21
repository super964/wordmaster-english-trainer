@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   WordMaster - 英语听说读写 AI 训练
echo   正在启动，请稍候...
echo ============================================
if not exist node_modules (
  echo 首次启动，正在安装依赖（需要几分钟）...
  call npm.cmd install electron --save-dev --registry=https://registry.npmmirror.com
)
call npm.cmd start
