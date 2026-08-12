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
- **第 3 层可变边界判断标准必须写进 prompt，不能让 VLM 自由发挥**：`rule_extraction.py` 早期只写"分析哪些元素可以替换、哪些不能动"，没给判断标准，导致同一套 prompt 在不同图上产生不一致的锁定尺度——腊肠犬图正确把"狗的样式/装饰"都归为 `replaceable_elements`，万圣节图却把"鬼屋/幽灵/南瓜黑猫/蝙蝠"这些具体物件全部锁进 `must_not_change`，只留 3 个文字维度可选，用户在界面上除了名字什么都换不了。根因是 prompt 没有区分"具体是什么"（应默认可替换）和"抽象构图/风格规则"（才该锁死）。修复：明确要求"图案里的具体物件/形象本身（主体品种、场景道具、装饰图案等）默认应拆进 `replaceable_elements`，即使它们构成了图案氛围也不例外；`must_not_change` 只放'无论怎么换元素都要遵守'的抽象规则（居中构图、色彩基调、排版结构），不放某个具体物件的名字"，并要求"一张图通常应有 3 项以上非文字类可替换维度"。判断这类 prompt 改动是否生效，不能只看 JSON 格式对不对，要重新分析同一张图对比 `replaceable_elements`/`must_not_change` 的实际内容
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
- **通用折叠区组件（`components/ui/CollapsibleSection.tsx`）**: 点标题栏展开/收起、右侧箭头 `rotate-180` 过渡，供"中文结构化提示词/生图提示词/可定制项/生成图片/版本A、B、C 配置区"共用，不再各自维护一套折叠 state。默认非受控（`defaultExpanded` 初始值，内部自管），传 `expanded`+`onExpandedChange` 切换为受控模式——版本A/B/C 的配置区用受控模式，在"生成成功"时由父组件把配置区强制收起（`setConfigExpanded(false)`），点标题栏可重新展开调整并再次生成
- **主题切换（浅色/暗色）**: `app/globals.css` 三层结构——`:root` 存暗色默认值 → `html.light` 覆盖浅色值 → `@theme inline` 的 `--color-codex-*` token 引用这些变量而非固定值，这样 `<html>` 加/去 `light` class 即可整体切换，全站 `codex-*` class 名不用改。`components/layout/ThemeToggle.tsx`（独立悬浮按钮，`fixed top-4 right-4`，不嵌入 Sidebar）用懒初始化直接读 DOM 上的 class 判断当前主题，切换时同步 `classList.toggle` + `localStorage['split:theme']`。`app/layout.tsx` 的 `<html>` 加 `suppressHydrationWarning` + `<head>` 内联防闪烁脚本（同步读 localStorage 在首次绘制前加好 class，避免刷新时先闪暗色再跳浅色，`try/catch` 包裹防隐私模式炸页面）

### 核心业务概念

- **规则卡 6 层**: 第 0 层核心卖点锚定（最高优先级，绝不可替换）→ 第 1 层商业层 → 第 2 层视觉结构 → 第 3 层可变边界 → 第 4 层产品适配（第一个 key 必须是竞品图本身的真实产品类型，按画面线索判断——裱框/悬挂→相框、穿着→T恤/卫衣、圆柱容器→马克杯，而非默认毛毯）→ 第 5 层数据验证（SABC 分级）
- **提示词三版（三栏并排，各自独立操作，目标产品下拉框统一用 `PromptVersionA/B/C` 共用的 `ProductSelect` 组件，支持"自定义"手动填产品名，兜底 AI 分析漏判/列不全的情况）**:
  - 版本 A（资料库关联）: 以核心卖点为锚点 → 两轮匹配（核心过滤+分维度加权 Jaccard：风格35%/色彩20%/构图20%/主题15%/情绪10%）→ 用户选参考图 → 独立后端接口 `POST /api/prompts/generate-a` 结构化融合
  - 版本 B（AI 推荐）: AI 自主推荐改款方向，与图库无关，不包含参考图推荐
  - 版本 C（自定义模板）: 下拉框选项+自定义输入
- **POD 定制**: 提示词自动从规则卡提取竞品图上识别到的**真实文案**（如 `Mom's Garden`、`You're My Favorite Weirdo`）作为示例，不用通用占位符。`MustHaveElement`/`ReplaceableItem` 都有 `is_text_slot` 字段（VLM 分析时直接标注），`_get_pod_hints()` 优先用这个字段判断，没有该字段的旧规则卡走关键词匹配兜底
- **可定制项（customization_slots）**: AI 分析判断这张图适合哪些可定制项（优先名字/年龄/团队/家族），位置与图设计适搭，不全加。用户可选勾选，勾选项的英文片段拼入生图提示词（每项只出现一次）。A/B/C 三版都有，默认全不选（可选可不选，未选则不改）
- **AI/VLM 响应解析**: 见上方"AI 响应 JSON 提取"

### 生图参考图支持（批次三 Spike 结论，2026-07）

实测方法：用同一张竞品图（毯子印花）+ 编辑式指令 prompt（"把主体替换成篮球，其余不变"），对比生成结果是否真的复用了输入图的构图/风格，而非只是接口不报错。

- **OpenAI 兼容模式 `/v1/images/edits`（multipart，`image` 字段传原图字节）：✅ 确认支持**。生成结果完整保留了原图的构图、边框花卉图案、悬挂手势，只有主体被替换成篮球——这是"真的参考了输入图"，不是巧合。超时需要 ≥60s（比纯文本生成慢，实测在 120s 内完成）。这是当前项目已配置模式（`api_type=openai`）的正确带图路径，批次四应使用这个接口，而非现状用的 `/v1/images/generations`
- **OpenAI 兼容模式 `/v1/images/generations` + 非标 `image` 字段（JSON body 直接塞 base64）：❌ 假支持，是反例**。请求返回 HTTP 200 且真的给了一张图，但内容与输入图完全无关（输入是毯子图案，输出是纯白背景孤零零一个篮球）——说明代理服务器**静默忽略**了这个未知字段，只是把 prompt 当成纯文本生成任务处理了。HTTP 200 不能作为"支持"的证据，必须实际比对生成内容
- **AIReiter 原生 `/api/openapi/submit`：⚠️ 当前环境无法验证，不是"不支持"结论**。项目里 `provider: aireiter` 但实际 `api_url` 配置的是自建中转代理（非 `aireiter.com`），探测发现这个代理**根本没有实现** `/api/openapi/submit` 路由（不管带不带图都 404）；同时真正的 `aireiter.com` 域名在当前网络环境无法解析（DNS 失败）。所以这条路径缺乏可用的实测环境，字段名（`images`/`image_urls`/`reference_images` 等候选）均未被证实或证伪，**不能假设它不支持带图**——批次四涉及 AIReiter 分支时若要接入带图，需要先在能连通真实 `aireiter.com` 的环境里重新验证，或找到官方文档（当前公开渠道搜不到）
- **结论对批次四的影响**：只对 OpenAI 模式的 `/v1/images/edits` 有把握实现"附带竞品原图生图"，AIReiter 分支保持纯文本、不做带图假设

### 双模式提示词（批次四实现，2026-07）

- **数据管道**：`ImageGenRequest` 加 `attach_rule_image`（默认 True）/`reference_image_paths`；`routers/image_gen.py submit_gen_task` 只在 `REFERENCE_SUPPORT[api_type]` 为真时才解析参考图（省掉不支持模式下的无意义图片预处理开销）——`attach_rule_image=True` 时 `get_rule(rule_id).source_images[0]` 取竞品原图磁盘路径，`reference_image_paths` 经 `_resolve_reference_path()` 白名单校验（`/uploads/`→`data/uploads/`、`/library-images/`→`data/library/images/`、`/gen-refs/`→`data/gen/refs/`，文件名单独 basename 化防 `..` 穿越），每张图过 `prepare_image_for_vlm()`（复用，格式转换+缩到 2048px+base64）得 `{b64, mime}` 列表传给 `client.submit_task(reference_images=...)`；`ImageGenTask.used_reference` 记录本次是否真的带了图（受支持 + 有可用图片路径双重满足），落库供生图任务页追溯
- **`image_gen_client.py`**：`REFERENCE_SUPPORT = {"openai": True, "aireiter": False}` 单一事实来源；`_openai_generate` 有参考图时切 `/v1/images/edits`（multipart，`_headers(include_content_type=False)` 让 httpx 自己生成 boundary），无图走现状 `/v1/images/generations`；`GET /api/gen/config` 响应加 `supports_reference` 字段供前端决定开关是否可用
- **`prompt_generator.py` 编辑指令式提示词（`image_prompt_edit`）**：与 `image_prompt_positive`（完整描述式，从头描述整个设计）并存，`_build_edit_prompt(target_product, modifications)` 组装"基于附图只改这几处"的短提示词，配合参考图使用比完整描述更精确。三版 modifications 来源不同：版本B 从 `recommended_changes` 逐维度生成 `Replace {original} with {changed_to}.`；版本C 复用 `_build_change_summary` 同款"是否真的变了"判断标准（`chosen = selections.get(field) or original`，`chosen == original` 才算没变）；版本A 无替换概念，是风格迁移指令（`Restyle with:`/`Recolor with:`/`Adjust composition to:`，只在实际提取到对应参考图特征时才生成对应一条）。**取值语言策略与 `_append_english` 相反**——`_edit_lang_value` 优先取 `*_en`，取不到时**放行原始中文值**（不丢弃、不占位替换），因为这段提示词会连同参考图一起发给模型，中文值只是给模型定位"图里的哪个元素"，不是要求画出中文字
- **前端 `PromptDisplay.tsx`**：`useReference` state 控制"完整描述 / 编辑指令"两种模式，初始值 = `hasRuleImage && !!result.image_prompt_edit && supportsReference`（三者都满足才默认开启，`supportsReference` 从 `GET /api/gen/config` 拉取，模块级变量 `_supportsReferenceCache` 缓存，A/B/C 三个 `PromptDisplay` 实例共享一次请求）；`effectivePositive`/`effectiveEdit` 用共享的 `applyFragments()` 纯函数各自拼接可定制项勾选片段，`activeEffective` 按 `useReference` 二选一，`MergedPromptBlock` 显示这个值，完成编辑时回写到当前激活模式的 base（`editablePositive` 或 `editableEdit`），两套编辑互不覆盖；开关 UI 在无竞品图/无 `image_prompt_edit`/当前接口不支持三种情况下置灰并显示原因；`ImageGenSection` 新增 `attachRuleImage`（= `useReference`）/`referencePaths` props，提交时带入 `attach_rule_image`/`reference_image_paths`（`referencePaths` 的真实来源见下方批次五）
- **已知限制**：AIReiter 分支的 `REFERENCE_SUPPORT` 目前是保守的 False，如果未来找到官方文档或换成可连通的真实 `aireiter.com` 环境重新验证过带图支持，需要同步改这个常量和 `_aireiter_submit`（当前完全没碰参考图参数）

### 生图流程参考图上传（批次五实现，2026-07）

- **新端点 `POST /api/gen/analyze-ref`**（`routers/image_gen.py`）：multipart 上传一张参考图 + `purpose`（用途说明，如"配色参考"），AI **只分析 purpose 指定的这一个维度**、忽略图片其他方面，返回 `{fragment, description_cn, ref_path}`。落盘 `data/gen/refs/{时间戳}_{清洗文件名}`，挂载到 `/gen-refs/`（`main.py`，与批次四已预留的 `_REFERENCE_PATH_WHITELIST["/gen-refs/"]` 对应同一目录）。校验顺序：`UPLOAD_ACCEPTED_MIME_TYPES` 白名单 → 20MB 大小上限 → 文件名 `Path(...).name` 清洗；AI 走 `load_ai_client_from_config()` + `prepare_image_for_vlm()`（复用批次四同款图片预处理）+ `temperature=0`（结构化任务）+ `extract_json_from_ai_response()`；未配置 AI 返回 400 提示先配置
- **system_prompt 的"只看 purpose 维度"约束**：颜色类 purpose 只描述颜色、绝不提主体/构图，构图类 purpose 只描述空间排列、绝不提颜色，其余维度同理只聚焦这一个维度。JSON 输出示例用方括号占位符（`"[按 purpose 指定的维度...]"`），不给具体值——这是本项目 VLM prompt 的强制约定（见"VLM 提示词里的 JSON 输出示例不能给具体值"），防止模型抄示例而不是真去分析图片。`fragment_en` 要求"可独立理解、不含指代性表述"（不能写"如图所示"这类话），因为这段文字会脱离原图单独拼进另一张完全不同图案的生图提示词里
- **前端 `PromptDisplay.tsx` 的 `ImageGenSection`**：新增 `refItems` state（本地数组，每项含 file/preview/purpose/analyzing/error/fragment/descriptionCn/refPath/appended），支持添加多张、每张独立分析/编辑/拼入/删除；折叠区默认收起（"➕ 添加参考图"，不是每次生图都需要）。"拼入提示词"通过 `onAppendFragment` 回调追加到 `PromptDisplay` 当前激活模式（编辑指令/完整描述）的 base 末尾——**不复用批次四的 `applyFragments()`**，那个函数末尾固定拼"each customizable element appears only once"（专为可定制项勾选设计的收尾句），参考图片段拼上这句语义不通，改用简单的逗号追加。`ref_path` 存入 `PromptDisplay` 层的 `referencePaths` state（提升到父组件，因为提交生图时要和 `attach_rule_image` 一起传给后端，这个 state 批次四就已预留字段位置，批次五开始真正填充）
- **已验证的关键点**：同一张参考图换 purpose（"配色参考" vs "构图参考"）分析出的 `fragment` 内容会切换聚焦维度（颜色 vs 布局），证明 prompt 是真的在跟着 purpose 分析而不是套固定模板；`_resolve_reference_path()`（批次四）能正确解析新生成的 `/gen-refs/...` 路径；竞品原图 + 额外参考图可以同时随一次生图请求发出

### 完整描述模式分段重构（批次六实现，2026-07）

- **`_build_image_prompts`（版本B/C共用）+ `generate_version_a`**：正向提示词从"逗号拼一整行"改为按语义换行分段——`Create a {product} print-on-demand design.` → `Composition: ...` → `Style: ...` → `The design MUST include: ...`（版本A 是独立一句 `reference_note`，不进 MUST include，保留"参考不是强制"的原语义）→ `Personalization: ...` → `Requirements: ...`。分段结构对模型更易解析重点；信息来源、`_append_english` 防中文泄漏机制、负向提示词逻辑完全不变，只改这一层的输出格式
- **顺带修复两个信息点**：① `target_product` 之前从未进入过英文提示词（只用于中文结构化提示词和内部逻辑），现在补进首句——但 `target_product` 真实格式是空格分隔的"英文名 中文名"（如 `"T-Shirt T恤"`），不是词表的"中文/English"斜杠格式，新增 `_extract_product_name_en()` 按空格切分取不含 CJK 的词（支持多词英文名如 `"Beach Towel"`，全部找不到英文时兜底原样返回）；② `must_have_elements` 的 `position` 字段之前读入但从未用上，现在拼进 MUST include 清单的括号里——**但 `position` 模型上是纯中文字段，没有 `_en` 平行版本**（`models/rule_card.py` 只有 `str`），必须过 `_extract_english` + `_contains_cjk` 检测，含中文就丢弃这段位置信息（只是不显示位置，元素本身仍保留），不能假设它是英文直接塞进提示词
- **`_get_pod_hints` 的返回值被拆分使用**（函数本身不变）：`hints[0]`（文字定制句）归 Personalization 段，`hints[1:]`（"clean printable design"等质量要求）归 Requirements 段，不再和其他质量词混在一起
- **验证方法**：不能只对比"新旧提示词字符串是否相等"（分段加了换行/句号，逐字符对比全是噪音），要把两版提示词按逗号/分号/句号统一切分成"信息点集合"再做差集对比，才能看出真正的语义级别信息增减
- **已知的既有限制（非本次引入，验证时发现）**：① 版本A 的 `adaptation_notes`（产品适配说明）用 `allow_cjk_fallback=True`，含中文时保留+仅记警告日志、不丢弃——这个字段本身没有 `_en` 平行版本，多数规则卡的这段说明就是纯中文，会原样进入英文提示词（用户已知悉，暂不处理）；② 手动编辑生图提示词（`MergedPromptBlock` 完成编辑）**不做任何中文检测**，用户输入什么就原样存什么，比①更容易触发中文泄漏（用户已知悉，暂不处理）
- **版本C 下拉选项中文小字翻译**：`generate_version_c_template` 从同步改为异步（`routers/prompts.py` 的 `GET /prompts/template-c/{id}` 需 `await` + 传 `ai_client`）。`_translate_english_options()` 收集 `selectable_fields` 里 `value` 不含 CJK 且含字母的选项（跳过纯中文、跳过纯数字/符号），去重后调一次 AI 批量翻译（`prompts/prompt_generation.py` 的 `get_option_translation_prompt`，JSON 示例占位符不给具体值），结果写回 `option.label_cn`（只前端展示用，不影响 `value`，不进最终提示词）。无 AI 客户端/翻译失败/结果数量对不上时静默跳过，不影响模板接口本身可用性。前端 `PromptVersionC.tsx` 渲染下拉框时若有 `label_cn` 拼成 `"{label} ({label_cn})"`——**原生 `<select>`/`<option>` 不支持不同字号的复合样式**，只能是纯文本拼接，不是真正的"小字体"

### 已知待改进项

- 后端 API 响应格式不统一（settings/vocabularies/gen 直接返回 vs 其他路由包 `{success, data}`），新增路由应统一用包装格式
- `http://localhost:8000` 在 `lib/api.ts` 和多个组件中硬编码，应提取为环境变量
- 规则卡 6 层类型定义在 RuleCardPreview 和 RuleCardEditor 中各自独立定义，应抽取共享
- `image_library_store.py` 的 SQLite 行转字典逻辑在 `list_images`/`recommend_for_rule` 里各写一份，可抽共享函数
- `image_analyzer.py`/`image_tagger.py`/`routers/library.py` 里同步 Pillow/文件 IO 直接跑在 async 路由里，未 `asyncio.to_thread` 化，量大时会阻塞事件循环
- 三个 `PromptVersion*.tsx` 组件仍各自重复"调接口 → setResult → 渲染 PromptDisplay"的样板逻辑（目标产品下拉框已抽成 `ProductSelect` 共享，其余部分未抽），可再抽 `useGeneratePrompt` hook
- `recommend_for_rule` 每次请求全表扫描图库无缓存，规则侧字段在每次循环内重复解析
- `_extract_core_keywords` 用简单中文分词+硬编码停用词表，匹配质量有限，考虑接入更专业的分词
