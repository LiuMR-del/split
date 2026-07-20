#!/bin/bash
# Split 项目一键停止（macOS 双击运行）
# 双击此文件 → 停止后端 + 前端

echo "⏹ 停止 Split 前后端..."

# 杀掉 uvicorn（后端）和 next（前端）相关进程
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null

echo "✅ 已停止"
sleep 1
