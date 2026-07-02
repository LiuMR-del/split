# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

竞品图案规则拆解与提示词生成系统——POD（Print on Demand）印花定制商品的设计起手加速器。上传竞品图 → AI 分析拆解为 6 层规则卡 → 生成结构化提示词 → 调用生图 API 出图。始终围绕 POD 个性化定制（名字/日期/照片位）展开。

## 启动命令

```bash
# 后端（在 backend/ 目录下）
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload   # --reload：代码改动自动重启，避免跑旧代码

# 前端（在 frontend/ 目录下）
npm install
npm run dev          # 开发服务器 localhost:3000，默认已带热重载
npm run build        # 生产构建
npm run lint         # ESLint 检查

# 导入种子数据（5条规则卡）
cd backend && python3 seed_rules.py
```

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS v4
- **后端**: Python 3.9 + FastAPI + Pydantic v2
- **存储**: JSON 文件（完整记录）+ SQLite（查询索引），双写模式
- **AI 调用**: httpx 异步请求，适配 OpenAI/Anthropic 两种 API 格式
- **生图**: 双模式——OpenAI 同步（gpt-image-2）+ AIReiter 异步（submit → poll query）
- **图片格式**: 支持 AVIF/HEIF（通过 pillow-heif 自动转 JPEG 发给 VLM）

## 关键架构约定

### 后端

- **Import 风格**: 绝对路径，如 `from services.rule_store import save_rule`，不用相对导入
- **Python 版本兼容**: 3.9，必须用 `Optional[X]` / `List[X]`（从 typing 导入），不用 `X | None` / `list[X]`
- **API 响应格式**: `rules/analyze/prompts/library` 路由用 `{"success": True, "data": ...}` 包装；`settings/vocabularies/gen` 路由直接返回裸数据。前端统一用 `lib/api.ts` 的 `unwrapData<T>()` 解包，不要再手写 `res.data || res`
- **存储模式**: rule_store / image_library_store / image_gen_store 三个模块采用相同的"JSON 文件 + SQLite 索引"双写模式。SQLite 只存筛选/排序字段，完整数据在 JSON 文件里
- **受控词表**: `vocabularies/` 下 7 个 JSON 文件（含 layout_type 构图），值格式为 `"中文/English"`。拆分用 `services/vocab_utils.py` 的 `extract_chinese_part`/`extract_english_part`，不要重新手写
- **图片格式兼容（单一事实来源）**: `services/image_format_utils.py` 统一定义 `UPLOAD_ACCEPTED_MIME_TYPES`（上传白名单）和 `VLM_SUPPORTED_FORMATS`（VLM 原生支持，其余走 Pillow 转 JPEG），`prepare_image_for_vlm()` 供 `image_analyzer.py`/`image_tagger.py` 共用。新增格式只改这一个文件
- **AI 响应 JSON 提取**: 统一用 `services/ai_response_utils.py` 的 `extract_json_from_ai_response()`（三级策略：直接解析 → ```json 代码块 → 首尾花括号），不要每个模块各写一份
- **AI 客户端加载**: 路由里要拿 `AIClient` 统一调 `services/ai_client.py` 的 `load_ai_client_from_config()`，不要各自重复读 config.json

### 前端

- **所有组件都是 Client Component**（`'use client'`），数据通过 `lib/api.ts` 客户端获取
- **Tailwind v4**: 主题定义在 `app/globals.css` 的 `@theme inline` 块中（不是 tailwind.config），颜色用 `codex-*` 前缀
- **UI 风格**: Codex 深色主题（#0d1117 背景 / #161b22 卡片 / #58a6ff 高亮 / JetBrains Mono 字体）
- **API 层**: `lib/api.ts` 导出 `apiGet/apiPost/apiPut/apiDelete/apiUpload` + `unwrapData<T>()`，baseURL 硬编码 `http://localhost:8000`
- **AGENTS.md 警告**: Next.js 16 有 breaking changes，写代码前先读 `node_modules/next/dist/docs/`

### 核心业务概念

- **规则卡 6 层**: 第 0 层核心卖点锚定（最高优先级，绝不可替换）→ 第 1 层商业层 → 第 2 层视觉结构 → 第 3 层可变边界 → 第 4 层产品适配（第一个 key 必须是竞品图原产品类型）→ 第 5 层数据验证（SABC 分级）
- **提示词三版（三栏并排，各自独立操作）**:
  - 版本 A（资料库关联）: 以核心卖点为锚点 → 两轮匹配（核心过滤+分维度加权 Jaccard：风格35%/色彩20%/构图20%/主题15%/情绪10%）→ 用户选参考图 → 独立后端接口 `POST /api/prompts/generate-a` 结构化融合
  - 版本 B（AI 推荐）: AI 自主推荐改款方向，与图库无关，不包含参考图推荐
  - 版本 C（自定义模板）: 下拉框选项+自定义输入
- **POD 定制**: 提示词自动从规则卡提取竞品图上识别到的**真实文案**（如 `Mom's Garden`、`You're My Favorite Weirdo`）作为示例，不用通用占位符。`MustHaveElement`/`ReplaceableItem` 都有 `is_text_slot` 字段（VLM 分析时直接标注），`_get_pod_hints()` 优先用这个字段判断，没有该字段的旧规则卡走关键词匹配兜底
- **AI/VLM 响应解析**: 见上方"AI 响应 JSON 提取"

### 已知待改进项

- 后端 API 响应格式不统一（settings/vocabularies/gen 直接返回 vs 其他路由包 `{success, data}`），新增路由应统一用包装格式
- `http://localhost:8000` 在 `lib/api.ts` 和多个组件中硬编码，应提取为环境变量
- 规则卡 6 层类型定义在 RuleCardPreview 和 RuleCardEditor 中各自独立定义，应抽取共享
- `image_library_store.py` 的 SQLite 行转字典逻辑在 `list_images`/`recommend_for_rule` 里各写一份，可抽共享函数
- `image_analyzer.py`/`image_tagger.py`/`routers/library.py` 里同步 Pillow/文件 IO 直接跑在 async 路由里，未 `asyncio.to_thread` 化，量大时会阻塞事件循环
- 三个 `PromptVersion*.tsx` 组件重复"调接口 → setResult → 渲染 PromptDisplay"的样板逻辑，可抽 `useGeneratePrompt` hook
- `recommend_for_rule` 每次请求全表扫描图库无缓存，规则侧字段在每次循环内重复解析
- `_extract_core_keywords` 用简单中文分词+硬编码停用词表，匹配质量有限，考虑接入更专业的分词
