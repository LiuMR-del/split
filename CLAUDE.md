# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

竞品图案规则拆解与提示词生成系统——POD（Print on Demand）印花定制商品的设计起手加速器。上传竞品图 → AI 分析拆解为 6 层规则卡 → 生成结构化提示词 → 调用生图 API 出图。始终围绕 POD 个性化定制（名字/日期/照片位）展开。

## 启动命令

**一键启动（推荐）**：双击项目根目录的 `启动项目.command` → 同时启动后端(8000)+前端(3000)，Terminal 显示日志，Ctrl+C 停；停止双击 `停止项目.command`。

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

- **单进程部署约束**: 存储层（rule_store / image_library_store / image_gen_store 的 `threading.Lock` + 占位文件、scan-max ID 生成）依赖 uvicorn 单 worker 单进程部署，禁 `--workers >1`，否则并发保护失效
- **Import 风格**: 绝对路径，如 `from services.rule_store import save_rule`，不用相对导入
- **Python 版本兼容**: 3.9，必须用 `Optional[X]` / `List[X]`（从 typing 导入），不用 `X | None` / `list[X]`
- **API 响应格式**: `rules/analyze/prompts/library` 路由用 `{"success": True, "data": ...}` 包装；`settings/vocabularies/gen` 路由直接返回裸数据。前端统一用 `lib/api.ts` 的 `unwrapData<T>()` 解包，不要再手写 `res.data || res`
- **存储模式**: rule_store / image_library_store / image_gen_store 三个模块采用相同的"JSON 文件 + SQLite 索引"双写模式。SQLite 只存筛选/排序字段，完整数据在 JSON 文件里
- **受控词表**: `vocabularies/` 下 7 个 JSON 文件（含 layout_type 构图），值格式为 `"中文/English"`。拆分用 `services/vocab_utils.py` 的 `extract_chinese_part`/`extract_english_part`，不要重新手写
- **图片格式兼容（单一事实来源）**: `services/image_format_utils.py` 统一定义 `UPLOAD_ACCEPTED_MIME_TYPES`（上传白名单）和 `VLM_SUPPORTED_FORMATS`（VLM 原生支持，其余走 Pillow 转 JPEG），`prepare_image_for_vlm()` 供 `image_analyzer.py`/`image_tagger.py` 共用。新增格式只改这一个文件
- **AI 响应 JSON 提取**: 统一用 `services/ai_response_utils.py` 的 `extract_json_from_ai_response()`（三级策略：直接解析 → ```json 代码块 → 首尾花括号），不要每个模块各写一份
- **AI 客户端加载**: 路由里要拿 `AIClient` 统一调 `services/ai_client.py` 的 `load_ai_client_from_config()`，不要各自重复读 config.json
- **递增 ID 生成**: 必须"扫描已有文件解析编号、取最大值 +1"，不能"数文件数量 +1"——序列中间任意一条被删除后，数量会永久比最大编号少 1，之后每次新建都会撞上仍然存在的旧编号且无法自愈。三种存储的 ID 生成按是否会被并发触发分两类：
  - **单请求→单生成**（`rule_store._generate_rule_id()`，analyze 一次上传出一张规则卡）：scan-max 无锁可接受
  - **并发触发**（`image_gen_store.generate_task_id()`、`image_library_store.generate_image_id()`，上传/提交会被并发调用）：必须加进程内锁 + 占位文件——锁内查 SQLite max + glob 已有文件（含占位）取较大值 +1，立即写 `{"_placeholder": true}` 占位文件再返回。否则跨请求并发会算出同一 ID，`INSERT OR REPLACE` + JSON 覆盖把先写入的数据冲掉、原图变孤儿（`image_library_store` 跨请求并发上传时复现过）。配套：`get_image`/`get_task` 读到占位文件要返回 None，避免调用方把半成品当成空数据
- **VLM 提示词里的 JSON 输出示例不能给具体值**：给 VLM 看的 `{"层字段": "示例值"}` 会被模式匹配抄写，而不是引导它去读图——`layer_4_product.adaptations` 曾经因为示例写死 `"Blanket 毛毯"` 导致 VLM 无论竞品图是什么都固定输出这四个产品。写分析类 prompt 的 JSON 示例，可变的字段要用方括号占位符描述"这里要填什么、怎么判断"，不能写成看起来像正确答案的具体值
- **生图图片下载要识别 data URI**：OpenAI 同步模式（`api_type=openai`）返回 `b64_json`，`image_gen_client._openai_generate()` 会拼成 `data:image/png;base64,...` 存入 `image_urls`。前端 `<img src>` 能直接渲染 data URI（所以生图后原地看图一直正常），但 `image_gen_store.download_images()` 用 `httpx.get(url)` 下载——httpx **不支持 data scheme**，必然抛异常被 `except: continue` 吞掉，返回空列表、`/api/gen/download` 报 400。下载循环里必须先 `url.startswith("data:")` 判断，是 data URI 就 base64 解码落盘，http URL 才走 httpx
- **可定制项（customization_slots）AI 分析**: A/B/C 三版都 AI 分析判断可定制项（不全加，判断哪些适配+位置），优先名字/年龄/团队/家族，限制 5 项。版本B 在 `_ai_recommend`（改款推荐）一并返回；版本A/C 单独调 `_ai_analyze_customization_slots`（prompt 见 `get_customization_analysis_prompt`），不推荐改款。无 AI 时 `_extract_customization_slots(rule_card, None)` 兜底（从 layer2.must_have 的 is_text_slot 提取，按关键词优先排序，position 用 layer2 实际位置经 `_translate_position_cn` 映射英文）。`generate_version_c` 路由必须传 `ai_client`（否则 C 无 AI 分析，只兜底）
- **图无中文（R1）**: 生成的图不能出现中文。`COMMON_NEGATIVE_PROMPTS` 加 `chinese characters/chinese text/hanzi`（不用 `cjk characters` 会误伤日韩、不用 `chinese fonts` 会误伤字体风格）；正向质量词加 `english text only`（OpenAI 模式 negative 合并进正向有"粉红大象"效应，正向引导更可靠）；`_get_pod_hints` 文字槽位文案经 `_sanitize_text_slot_value` 处理（`_contains_cjk` 检测，含中文转 NAME/2026，不误伤拉丁重音如 José/café）
- **POD 文字槽位去重（图中出现重复 name 的根因）**: `_get_pod_hints` 从规则卡两层收集文字位——`layer_3.replaceable_elements`（如 `犬种名称='Dachshund'`）和 `layer_2.must_have_elements`（如 `主题文字区` 描述"大号手写体主题文字，当前为'Dachshund'"）常常是**同一个文字元素的两次记录**，槽位名不同所以按 key 去重无效；且 `must_have` 的中文描述经 `_sanitize_text_slot_value` 会被统一转成 `'NAME'`，多个槽位各转一次就变成 `'NAME', 'NAME'`。两道防线：① 收集 must_have 时若 `desc` 包含任一已提取的文案值判定为同一元素，跳过；② 拼提示词前按值去重（保序）。正向提示词额外加 `each text appears exactly once` 兜底引导。三种规则卡形态（新版 is_text_slot 优先路径、旧版关键词兜底路径、纯中文双槽位）都需要验证
- **生图同步超时时长**: `image_gen_client._openai_generate` 的 httpx 超时是 300 秒（曾是 120 秒，实测上游代理出图耗时 60 秒~4 分钟，120 秒会把"慢"误判成"错"报 500，图其实仍在后台生成只是等待方已断开）。前端 `PromptDisplay` 的提交按钮文案、轮询 `maxDuration`（5 分钟）需和后端超时保持同步，改一处另一处也要跟着改
- **分析方向 hint（R2）**: `POST /api/analyze` 接收可选 `hint` Form 字段，`image_analyzer._append_hint` 追加到 VLM user_prompt（约束句放最后防 recency bias 注入，花括号转义，控制字符过滤，限长 1000）。SABC 分级（`_grade_sabc`）不接 hint（复用价值是客观判断，不能被用户输入抬分），只 6 层拆解（`_extract_rules`）接
- **JSON 原子写（#11）**: 三个 store 的 `save_*`/`update_*` 统一用 `services/file_utils.py` 的 `atomic_write_json(path, data)`（写 `.tmp` → flush+fsync → `os.replace` 原子替换），防进程中断（Ctrl-C/停止项目.command）截断损坏唯一数据源。占位文件写入不用原子（影响小）；SQLite 不动（自有 WAL）
- **中文泄漏进英文提示词（#1 根因）**: VLM 按中文 prompt 输出的自由文本字段（`layout_formula`/`description`/`original`/`alternatives`/`core_selling_point`）会被 `extract_english_part` 原样返回（无 `/` 时不提取），拼入英文生图提示词造成中文泄漏——这是"图无中文 R1"的根因升级。根因方案：`rule_extraction` prompt 要求 VLM 同时输出英文平行字段 `*_en`（JSON 示例用方括号占位符**不给具体值**），`rule_card` model 加 Optional `*_en`；组装用 `_append_english(parts, text, field, allow_cjk_fallback=False)`——优先取 `*_en`，缺失回退中文，含 CJK 时丢弃+warning（版本A 的 `layout_formula`/`adaptation_notes` 用 `allow_cjk_fallback=True` 保留+warning，不丢关键构图/适配信息）；`replaceable` 的 chosen 替换值用 `alternatives_en` 索引映射。`step4`/`step5` 遍历 replaceable/must_have 时跳过 `is_text_slot`（用 `_parse_is_text_slot` 解析防字符串"false"误判），文字槽位文案由 `_get_pod_hints` 统一处理
- **VLM 两次调用并行（#7）**: `image_analyzer.analyze` 用 `asyncio.gather(_grade_sabc, _extract_rules, return_exceptions=True)`（两次调用只依赖同一张图、互相独立），Exception 降级（SABC→`{}`、拆解→`{"parse_error":...}` 走 `_empty_rule_card` 空壳路径，`_build_rule_card` 已对空值 `.get()` 容错），分析耗时近乎减半
- **生图按 api_type 分支（#8）**: `image_gen.py submit` 抽 `_submit_one` 协程，AIReiter 模式 `asyncio.gather` 并发（submit 不等出图，限流压力小），OpenAI 模式串行（图片 API 限流严，Tier 1 个位数 RPM，并发会集体 429）。前端 `taskId`/`taskStatus`/`images` 是单值只跟踪第一个任务，count>1 用 `multiTaskHint` 提示"其余去生图任务页"（多任务状态重构留后续）
- **AI 客户端健壮性（#13）**: `ai_client.py` 的 `MAX_TOKENS=8192`（6 层中文 JSON 输出量大，4096 易截断致 JSON 解析失败出空壳卡）；`_request_with_retry` 对 429/5xx/`httpx.TimeoutException` 指数退避重试（1s→2s，最多 2 次，重试耗尽抛原异常）；`text_request`/`analyze_image` 加 `temperature` 参数——结构化任务（6 层拆解/打标/可定制项分析）传 0 稳定，创意任务（`_ai_recommend` 改款推荐）**不传**保持多样性
- **版本B 推荐改动卡片（#2）**: `generate_version_b` 出口加工 `recommended_changes_detail`（`[{dimension, original, changed_to}]`），original 只从 `layer_3.replaceable_elements[dim].original` 取（单一事实来源，**不动 AI prompt/`_random_recommend`**——让 AI 重述 original 会与规则卡存储值不一致）。前端 `PromptDisplay` 用此字段渲染绿色「🎯 AI推荐改动」卡片，original 加 `change.original &&` 守卫
- **规则 ID 撞车重分配（#25）**: `rule_store.generate_rule_id()`（scan-max+1，共用）。`create_rule` 保存时若 `get_rule(rule_id)` 已存在（双标签页同时分析未保存导致预生成同 ID），后端重分配新 ID 而非报 409。分析阶段仍预生成 rule_id 供预览，前端用返回的 rule_id（localStorage 已按 `rule_id+created_date` 隔离）
- **诊断日志**: `routers/prompts.py`（generate-a/b/c）和 `routers/image_gen.py`（submit）的 except 块有 `logging.exception` 打印完整异常栈（排查 500 用，HTTPException 的 detail 只给 `str(e)` 会丢栈）。版本B `generate-b` 偶发 500 是 AI 抖动（`_call_ai_for_json` 已 `except Exception` 兜底降级到随机推荐，#13b 重试根治）
- **图片格式扩展（#4/#6）**: `image_format_utils._CONVERTIBLE_MIME_TYPES` 含 `image/heic`/`image/heif`（pillow-heif 已注册解码器，iPhone 默认格式可传）；`prepare_image_for_vlm` 统一所有格式走 Pillow + `thumbnail((VLM_MAX_DIMENSION, VLM_MAX_DIMENSION), LANCZOS)`（2048px，只缩小不放大，只改发送路径**不动落盘原图**），原生格式 png/webp/gif 保留，其余转 JPEG。上传白名单两入口（analyze/library）统一引用 `UPLOAD_ACCEPTED_MIME_TYPES`，library 不能用 `startswith("image/")`（会放行 SVG 等打标必炸格式）
- **规则卡缩略图链路（#12）**: 分析返回 `uploaded_image` → 前端 `analyze/page.tsx` handleSave 随 RuleCard 传 `thumbnail_path` → `rules.py create_rule` 传 `save_rule` → `RuleCardList` 渲染缩略图（旧卡无则文字卡片兜底）；`rule_store.delete_rule` **先读 JSON 取 `source_images`/`thumbnail_path`** 再删 JSON/SQLite/清 `data/uploads/` 文件（顺序关键，删 JSON后读不到）

### 前端

- **所有组件都是 Client Component**（`'use client'`），数据通过 `lib/api.ts` 客户端获取
- **Tailwind v4**: 主题定义在 `app/globals.css` 的 `@theme inline` 块中（不是 tailwind.config），颜色用 `codex-*` 前缀
- **UI 风格**: Codex 深色主题（#0d1117 背景 / #161b22 卡片 / #58a6ff 高亮 / JetBrains Mono 字体）
- **API 层**: `lib/api.ts` 导出 `apiGet/apiPost/apiPut/apiDelete/apiUpload` + `unwrapData<T>()`，baseURL 硬编码 `http://localhost:8000`
- **AGENTS.md 警告**: Next.js 16 有 breaking changes，写代码前先读 `node_modules/next/dist/docs/`
- **提示词编辑 state 流向（PromptDisplay）**: `editablePositive/editableNegative`（base，MergedPromptBlock 编辑回写）-> `effectivePositive`（base + 勾选 fragment + "each customizable element appears only once"）-> `finalPositive`（预览块可编辑覆盖，默认 undefined 用 effectivePositive）-> `imageGenPositive`（finalPositive ?? effectivePositive，给 ImageGenSection）。useEffect 拆分：editable 只依赖值（不依赖 result 引用，避免编辑后被重置），selectedSlotIndices 依赖 customization_slots。textarea 用 auto-resize（ref + scrollHeight）对齐只读 pre
- **版本C 自定义值本地存储**: `lib/localStorage.ts` 按 `rule_id + created_date` 隔离（rule_id 可能复用，用 created_date 区分新旧规则卡），shape 校验（只留 string[] 字段，防损坏数据让面板崩），哨兵 `__custom__` 读写侧都过滤。`PromptVersionC.mergeCustomOptions` 加载时合并历史值，`handleGenerate` 落盘 + 落盘后重合并即时反映

### 核心业务概念

- **规则卡 6 层**: 第 0 层核心卖点锚定（最高优先级，绝不可替换）→ 第 1 层商业层 → 第 2 层视觉结构 → 第 3 层可变边界 → 第 4 层产品适配（第一个 key 必须是竞品图本身的真实产品类型，按画面线索判断——裱框/悬挂→相框、穿着→T恤/卫衣、圆柱容器→马克杯，而非默认毛毯）→ 第 5 层数据验证（SABC 分级）
- **提示词三版（三栏并排，各自独立操作，目标产品下拉框统一用 `PromptVersionA/B/C` 共用的 `ProductSelect` 组件，支持"自定义"手动填产品名，兜底 AI 分析漏判/列不全的情况）**:
  - 版本 A（资料库关联）: 以核心卖点为锚点 → 两轮匹配（核心过滤+分维度加权 Jaccard：风格35%/色彩20%/构图20%/主题15%/情绪10%）→ 用户选参考图 → 独立后端接口 `POST /api/prompts/generate-a` 结构化融合
  - 版本 B（AI 推荐）: AI 自主推荐改款方向，与图库无关，不包含参考图推荐
  - 版本 C（自定义模板）: 下拉框选项+自定义输入
- **POD 定制**: 提示词自动从规则卡提取竞品图上识别到的**真实文案**（如 `Mom's Garden`、`You're My Favorite Weirdo`）作为示例，不用通用占位符。`MustHaveElement`/`ReplaceableItem` 都有 `is_text_slot` 字段（VLM 分析时直接标注），`_get_pod_hints()` 优先用这个字段判断，没有该字段的旧规则卡走关键词匹配兜底
- **可定制项（customization_slots）**: AI 分析判断这张图适合哪些可定制项（优先名字/年龄/团队/家族），位置与图设计适搭，不全加。用户可选勾选，勾选项的英文片段拼入生图提示词（每项只出现一次）。A/B/C 三版都有，默认全不选（可选可不选，未选则不改）
- **AI/VLM 响应解析**: 见上方"AI 响应 JSON 提取"

### 已知待改进项

- 后端 API 响应格式不统一（settings/vocabularies/gen 直接返回 vs 其他路由包 `{success, data}`），新增路由应统一用包装格式
- `http://localhost:8000` 在 `lib/api.ts` 和多个组件中硬编码，应提取为环境变量
- 规则卡 6 层类型定义在 RuleCardPreview 和 RuleCardEditor 中各自独立定义，应抽取共享
- `image_library_store.py` 的 SQLite 行转字典逻辑在 `list_images`/`recommend_for_rule` 里各写一份，可抽共享函数
- `image_analyzer.py`/`image_tagger.py`/`routers/library.py` 里同步 Pillow/文件 IO 直接跑在 async 路由里，未 `asyncio.to_thread` 化，量大时会阻塞事件循环
- 三个 `PromptVersion*.tsx` 组件仍各自重复"调接口 → setResult → 渲染 PromptDisplay"的样板逻辑（目标产品下拉框已抽成 `ProductSelect` 共享，其余部分未抽），可再抽 `useGeneratePrompt` hook
- `recommend_for_rule` 每次请求全表扫描图库无缓存，规则侧字段在每次循环内重复解析
- `_extract_core_keywords` 用简单中文分词+硬编码停用词表，匹配质量有限，考虑接入更专业的分词
