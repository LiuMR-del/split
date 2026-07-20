#!/bin/bash
# Split 项目一键启动（macOS 双击运行）
# 双击此文件 → Terminal 自动启动后端 + 前端

cd "$(dirname "$0")"

echo "=========================================="
echo "  Split 项目启动"
echo "  后端 API: http://localhost:8000"
echo "  前端页面: http://localhost:3000"
echo "  停止：按 Ctrl+C，或双击「停止项目.command」"
echo "=========================================="
echo ""

# 校验目录
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
  echo "❌ 未找到 backend/frontend 目录"
  echo "请确认此文件放在项目根目录（与 backend/、frontend/ 同级）"
  read -p "按回车关闭窗口..."
  exit 1
fi

# 启动后端（后台，端口 8000）
echo "▶ 启动后端（端口 8000）..."
(cd backend && exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &
BACKEND_PID=$!

# 等 2 秒让后端先起来（前端依赖后端 API）
sleep 2

# 启动前端（后台，端口 3000）
echo "▶ 启动前端（端口 3000）..."
(cd frontend && exec npm run dev) &
FRONTEND_PID=$!

echo ""
echo "✅ 启动中... 浏览器打开 → http://localhost:3000"
echo "   （首次启动前端编译需 10-30 秒，请耐心等待）"
echo "   后端 PID $BACKEND_PID / 前端 PID $FRONTEND_PID"
echo ""

# Ctrl+C 时清理两个进程
cleanup() {
  echo ""
  echo "⏹ 正在停止前后端..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  sleep 1
  # 兜底：杀掉可能残留的子进程（uvicorn --reload 会 fork 子进程）
  pkill -f "uvicorn main:app" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  echo "✅ 已停止，可关闭此窗口"
  exit 0
}
trap cleanup INT TERM

# 阻塞等待（保持窗口不退出）
wait
