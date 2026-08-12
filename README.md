# Split — 竞品图案规则拆解与提示词生成系统

面向亚马逊 POD 卖家：把竞品主图拆解为可复用的图案规则，再据此生成新品设计提示词。

- 后端：FastAPI（端口 8000）
- 前端：Next.js（端口 3000）

---

## 换到新电脑怎么跑起来

**前置：** Python 3.9+ 与 Node.js 18+

**1. 克隆并装依赖**

```bash
git clone <本仓库地址>
cd Split

# 后端
pip3 install -r backend/requirements.txt

# 前端
cd frontend && npm install && cd ..
```

**2. 启动**

双击 `启动项目.command`（会同时拉起前后端），或手动：

```bash
# 终端 1：后端
cd backend && python3 -m uvicorn main:app --port 8000 --reload

# 终端 2：前端
cd frontend && npm run dev
```

打开 http://localhost:3000

停止：双击 `停止项目.command`，或在终端按 Ctrl+C。

**3. 首次使用需配置 AI 凭证**

在页面的配置区填入 AI 接口地址与 Key（会写入 `backend/data/config.json`，该文件不入库）。

---

## 仓库里没有什么

本仓库**只含源码**，以下内容不入库，换机后会是一套干净的空系统：

- `node_modules/`、`frontend/.next/`（装依赖与构建时自动生成）
- `backend/data/config.json`、`gen_config.json` — AI 凭证配置，需重新填
- `backend/data/*.db` — 规则库数据库，**已积累的规则需自行拷贝**
- `backend/data/uploads/`、`rules/`、`library/`、`gen/` — 上传图与生成产物

> 想把旧机器的规则库带过去：拷贝 `backend/data/` 整个目录即可。

---

## 项目结构

```
backend/               FastAPI 后端
frontend/              Next.js 前端
启动项目.command        一键启动前后端
停止项目.command        一键停止
CLAUDE.md              开发约定与架构说明
需求文档_竞品图案规则拆解与提示词生成系统_v1.md
需求二期实施方案.md
实施方案V2.md
验证报告_*.md           阶段性验证记录
```
