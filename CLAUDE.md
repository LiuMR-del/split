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
- **受控词表**: `vocabularies/` 下 8 个 JSON 文件（含 layout_type 构图、product_type 产品类型），值格式为 `"中文/English"`。拆分用 `services/vocab_utils.py` 的 `extract_chinese_part`/`extract_english_part`，不要重新手写
- **`product_type` 词表注入 prompt 前必须转成 `English 中文` 格式**（2026-08-18）：词表文件本身沿用全项目统一的 `"中文/English"` 斜杠格式，但 `layer_4_product.adaptations` 的 **key 历来是空格分隔的 `English 中文`**（如 `"T-Shirt T恤"`），三个下游消费方都依赖它——`prompt_generator._get_adaptation()` 做**精确 key 匹配**、`_extract_product_name_en()` 按**空格切分**取不含 CJK 的词（多词英文名如 `Picture Frame` 能正确保留）、前端 `ProductSelect` 直接把 key 当下拉选项显示。所以 `prompts/rule_extraction._product_type_options()` 做格式转换后再注入，让 VLM 直接输出可用的 key，而不是输出斜杠格式再在下游到处做兼容。**注入时过滤掉 `未识别/Unknown`**——那是"确实判断不出"的兜底值，出现在"请从中选择"的清单里会诱导 VLM 偷懒选它；前端 `getProductOptionsFromRuleCard` 也要过滤它（否则生图提示词首句会变成 `Create a Unknown print-on-demand design.`），过滤后为空则回落内置常见产品
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
- **hint 里的"产品品类"是第一手事实要硬采纳，其余仍是参考方向**（2026-08-18，运营反馈"哪怕在输入框说明了品类也识别不出"）：原措辞写"以上用户补充内容**只是参考方向**"，把用户的话降级成可忽略的建议——用户明确写了载体，VLM 仍按画面自己猜。现在 `_append_hint` 分两类处理：品类/载体**必须以用户说明为准**并映射到受控词表（用户看得到实物，属第一手事实）；风格/卖点等仍作参考方向。**防注入设计不动**——约束句照旧放最后，且明确"除产品品类外其他字段不得因用户要求而伪造"。实测注入攻击（要求填 `style=HACKED`、`reuse_level=SSS`、覆盖 layer_0、不输出 JSON）全部被挡住，只有品类按预期可被影响
- **第 4 层禁止默认填毛毯，判断不出就填 `Unknown 未识别`**：改前统计 **51 张规则卡里 26 张（超过一半）的首个 key 是 `Blanket 毛毯`**，大量是错的（如 RULE-0015 文件名标着 `08×12inch` 相框尺寸却判成毛毯）。prompt 里把这个统计事实直接写给 VLM 看 + 明确"毛毯只有在确实看到叠起的织物/盖在身上时才能填" + 给出"允许填未识别"的出口（**填未识别远好过瞎猜**，下游提示用户手动指定）。实测回归：RULE-0015 `Blanket → Poster` 已纠正，真毛毯 RULE-0018 仍判 `Blanket`（未过度纠偏）。词表覆盖不到的载体要**补词表**而不是让 VLM 硬凑——实测灯笼图在补词表前正确返回 `Unknown 未识别`，补入"灯笼/装饰木牌/亚克力灯牌/小夜灯"等 5 项后返回 `Lantern 灯笼`
- **JSON 原子写（#11）**: 三个 store 的 `save_*`/`update_*` 统一用 `services/file_utils.py` 的 `atomic_write_json(path, data)`（写 `.tmp` → flush+fsync → `os.replace` 原子替换），防进程中断（Ctrl-C/停止项目.command）截断损坏唯一数据源。占位文件写入不用原子（影响小）；SQLite 不动（自有 WAL）
- **中文泄漏进英文提示词（#1 根因）**: VLM 按中文 prompt 输出的自由文本字段（`layout_formula`/`description`/`original`/`alternatives`/`core_selling_point`）会被 `extract_english_part` 原样返回（无 `/` 时不提取），拼入英文生图提示词造成中文泄漏——这是"图无中文 R1"的根因升级。根因方案：`rule_extraction` prompt 要求 VLM 同时输出英文平行字段 `*_en`（JSON 示例用方括号占位符**不给具体值**），`rule_card` model 加 Optional `*_en`；组装用 `_append_english(parts, text, field, allow_cjk_fallback=False)`——优先取 `*_en`，缺失回退中文，含 CJK 时丢弃+warning（版本A 的 `layout_formula`/`adaptation_notes` 用 `allow_cjk_fallback=True` 保留+warning，不丢关键构图/适配信息）；`replaceable` 的 chosen 替换值用 `alternatives_en` 索引映射。`step4`/`step5` 遍历 replaceable/must_have 时跳过 `is_text_slot`（用 `_parse_is_text_slot` 解析防字符串"false"误判），文字槽位文案由 `_get_pod_hints` 统一处理
- **VLM 两次调用并行（#7）**: `image_analyzer.analyze` 用 `asyncio.gather(_grade_sabc, _extract_rules, return_exceptions=True)`（两次调用只依赖同一张图、互相独立），Exception 降级（SABC→`{}`、拆解→`{"parse_error":...}` 走 `_empty_rule_card` 空壳路径，`_build_rule_card` 已对空值 `.get()` 容错），分析耗时近乎减半
- **分析失败标记的字段名是 `_parse_error`（带下划线），前后端必须同名**（2026-08-18 实测踩坑）：后端 `_build_rule_card` 把失败原因写进 `rule_card["_parse_error"]`，而前端 `analyze/page.tsx` 曾检查不带下划线的 `parse_error`——字段名漂移导致"上游 AI 代理 502"这类失败被**当成成功**渲染成空壳卡（标题"解析失败 - 待人工填写"），用户看不到任何失败原因，误以为解析逻辑坏了。现单图/批量两条路径都查 `card._parse_error || card.parse_error`（防御两个名字），有值时抛 `AI 分析失败（可稍后重试）：{原因}` 走错误态。配套 `ai_client._raise_with_body`：非 2xx 抛错时把上游响应体（截 300 字）带进异常消息——裸 `raise_for_status()` 只有状态码没有原因，排查全靠猜；异常类型仍是 `HTTPStatusError`，重试判断不受影响。**上游代理（64.186.233.107）会间歇性 502**（实测同一请求几分钟内 200↔502 反复横跳、响应体为空），5xx 已有 2 次退避重试，抖动窗口超过重试跨度时失败是预期行为，此时正确的表现是"报出原因让用户稍后重试"，不是想办法遮掩成空壳成功
- **生图按 api_type 分支（#8）**: `image_gen.py submit` 抽 `_submit_one` 协程，AIReiter 模式 `asyncio.gather` 并发（submit 不等出图，限流压力小），OpenAI 模式串行（图片 API 限流严，Tier 1 个位数 RPM，并发会集体 429）。前端 `taskId`/`taskStatus`/`images` 是单值只跟踪第一个任务，count>1 用 `multiTaskHint` 提示"其余去生图任务页"（多任务状态重构留后续）
- **AI 客户端健壮性（#13）**: `ai_client.py` 的 `MAX_TOKENS=8192`（6 层中文 JSON 输出量大，4096 易截断致 JSON 解析失败出空壳卡）；`_request_with_retry` 对 429/5xx/`httpx.TimeoutException` 指数退避重试（1s→2s，最多 2 次，重试耗尽抛原异常）；`text_request`/`analyze_image` 加 `temperature` 参数——结构化任务（6 层拆解/打标/可定制项分析）传 0 稳定，创意任务（`_ai_recommend` 改款推荐）**不传**保持多样性
- **版本B 推荐改动卡片（#2）**: `generate_version_b` 出口加工 `recommended_changes_detail`（`[{dimension, original, changed_to}]`），original 只从 `layer_3.replaceable_elements[dim].original` 取（单一事实来源，**不动 AI prompt/`_random_recommend`**——让 AI 重述 original 会与规则卡存储值不一致）。前端 `PromptDisplay` 用此字段渲染绿色「🎯 AI推荐改动」卡片，original 加 `change.original &&` 守卫
- **规则 ID 撞车重分配（#25）**: `rule_store.generate_rule_id()`（scan-max+1，共用）。`create_rule` 保存时若 `get_rule(rule_id)` 已存在（双标签页同时分析未保存导致预生成同 ID），后端重分配新 ID 而非报 409。分析阶段仍预生成 rule_id 供预览，前端用返回的 rule_id（localStorage 已按 `rule_id+created_date` 隔离）
- **诊断日志**: `routers/prompts.py`（generate-a/b/c）和 `routers/image_gen.py`（submit）的 except 块有 `logging.exception` 打印完整异常栈（排查 500 用，HTTPException 的 detail 只给 `str(e)` 会丢栈）。版本B `generate-b` 偶发 500 是 AI 抖动（`_call_ai_for_json` 已 `except Exception` 兜底降级到随机推荐，#13b 重试根治）
- **图片格式扩展（#4/#6）**: `image_format_utils._CONVERTIBLE_MIME_TYPES` 含 `image/heic`/`image/heif`（pillow-heif 已注册解码器，iPhone 默认格式可传）；`prepare_image_for_vlm` 统一所有格式走 Pillow + `thumbnail((VLM_MAX_DIMENSION, VLM_MAX_DIMENSION), LANCZOS)`（2048px，只缩小不放大，只改发送路径**不动落盘原图**），原生格式 png/webp/gif 保留，其余转 JPEG。上传白名单两入口（analyze/library）统一引用 `UPLOAD_ACCEPTED_MIME_TYPES`，library 不能用 `startswith("image/")`（会放行 SVG 等打标必炸格式）
- **规则卡缩略图链路（#12）**: 分析返回 `uploaded_image` → 前端 `analyze/page.tsx` handleSave 随 RuleCard 传 `thumbnail_path` → `rules.py create_rule` 传 `save_rule` → `RuleCardList` 渲染缩略图（旧卡无则文字卡片兜底）；`rule_store.delete_rule` **先读 JSON 取 `source_images`/`thumbnail_path`** 再删 JSON/SQLite/清 `data/uploads/` 文件（顺序关键，删 JSON后读不到）
- **用户偏好存储（三期阶段一）**: `services/user_prefs_store.py` 存"跨规则卡通用、跟着人走"的偏好（自定义产品名 / 自定义尺寸预设 / 上次使用尺寸），数据在 `data/user_prefs.json`。与其他三个 store 的"JSON + SQLite 双写"模式**不同**：数据量极小（各 20 条上限）、不需要筛选排序，所以只有单 JSON 文件、无 SQLite 索引；也**没有递增 ID，因此不需要占位文件机制**——`threading.Lock`（保护 load→改→写 的 read-then-write）+ `atomic_write_json` 足够。读取侧 `load_prefs()` 做逐字段 shape 校验（`_sanitize_products`/`_sanitize_size_presets`/`_sanitize_last_size`），文件不存在/JSON 损坏/字段类型不对一律静默丢弃并回落默认值，**绝不抛错**——偏好是锦上添花的数据，坏了最多"记不住"，不能让接口 500 或阻断生成/生图。路由 `routers/user_prefs.py` 六个端点用 `{"success": True, "data": ...}` 包装格式；store 抛 `ValueError`（入参非法）→ 400，其余异常 → `logging.exception` + 500。DELETE 走 query 参数（产品名/尺寸 label 含中文空格，前端需 `encodeURIComponent`）
- **元素拆分图链路（三期阶段四 · 需求1）**: `GET /api/prompts/elements/{rule_id}`（`extract_element_list`，纯同步计算不调 AI）+ 前端 `ElementExtractSection` 逐元素调**现有** `POST /api/gen/submit`（`version='E'`、`attach_rule_image=true` 把竞品原图当参考图）+ `POST /api/gen/download-zip` 打包。五条约定：
  - **抠取指令模板 `ELEMENT_EXTRACTION_PROMPT_TEMPLATE`（`prompts/prompt_generation.py`）五段都是实测出来的，删任何一段都会退化**（改模板前重跑 Spike，方案文档 §6.7 有完整数据）：
    ① **原位擦除**（`erase-everything-else, NOT a re-draw` + 锁定 position/size/scale + 锁定画布 framing）。第一版写的是 `Place it alone, centered`，**主动要求了重新居中**，位置全错——这是用户实测反馈的头号问题。改后实测输出 1086×1448=原图尺寸、元素落在 x 0.07~0.92/y 0.27~0.60（原图 x 0.06~0.94/y 0.32~0.56）
    ② **出白底而非透明底**（见下条）
    ③ **`{others}` 显式点名要擦掉的元素**：只写 `Erase every other element` 时模型**不敢删主体**——实测抠"彩虹拱门"，花卉/文字/云朵都擦干净了、**猫却完整留着**。加点名清单 + `Erasing the main subject is REQUIRED if it is listed above` 后，猫区域不透明占比从 60%+ 降到 **0.1%**。清单由 `extract_element_list` 用**全部元素**（含被过滤掉的文字位，文字也得擦）减去目标本身生成，且用 `_is_semantic_duplicate` 排掉与目标同义的表述（否则出现"擦掉 X"与"保留 X"自相矛盾）；长句用 `_shorten_label` 截短（整句塞进清单会稀释指令）
    ④ **风格锁定**（只写 `Reproduce it exactly as it appears` 时海龟/珊瑚被画成照片级写实、丢手绘笔触——该句对"画什么"约束够、对"怎么画"不足）
    ⑤ **消除 mockup 干扰**（竞品图常是装裱画布/实物摆拍，模型会当实物语境更偏写实；告知"这是平面 2D 印刷图案"后再降一档）
  - **元素拆分必须显式要求上游"不要自己抠"（`background="opaque"`），本地抠**（2026-08-18 修正，**推翻了下一条早先的"让它出白底"说法**）：`_openai_generate` 早先**完全不传 `background` 参数**，此时上游**自作主张返回 RGBA 已抠图**——不是白底 RGB。后果有二：① 它抠得有碎洞（实测 `wildflower sprigs` 内部空洞 4.68%、`ivy vines` 2.48%、`eucalyptus branches` 2.33%，用户反馈的"主体元素缺失"根因在此）；② `white_to_transparent()` 入口的 `already_transparent` 判断使**本地抠图代码从未执行过**（24 张实测全部命中该分支直接返回）。现改为 `submit_task(..., force_opaque=True)` → 请求体加 `background="opaque"`（两个分支都加：`/v1/images/edits` 的 multipart 值必须是字符串），**只有 `version=='E'` 传 True**（`routers/image_gen.py` 的 `_submit_one`），普通 POD 生图不受影响。实测上游接受该参数、返回 `mode=RGB` 原尺寸整图且位置正确。`white_to_transparent` 入口保留 RGBA 兜底（合成回白底重抠，`reprocessed_from_alpha` 标记），但**兜底质量差于正常路径**——洞里的原色在上游抠图时已永久丢失，只能补成白色，实测枝叶间隙会被误填
  - **判断抠图质量必须合成到对比色背景目视确认，"内部空洞率"这个指标会骗人**：该指标（透明且不与画布边缘连通的像素占比）在本项目连续三次给出错误结论——兔子"8.6% 破损"实为矩形包围盒内耳朵旁的正常背景；`wildflower sprigs` 的 4.68% 里大部分是**枝叶之间本就该透明的间隙**，按它"补洞"反而把间隙填白（合成红底一眼可见变差）。同理，**没传 `background` 参数时不要假设上游返回什么**：同一个代理，要求保持原位置时会忽略 `background=transparent` 返回白底 RGB，不传参数时却返回 RGBA，每次都要实测 `Image.open().mode`
  - ~~**透明底靠后端转换，不靠生图 API 的 `background=transparent` 参数**~~（**上一条已推翻其中"上游返回白底"的前提**，保留记录供追溯）：该参数**确实有效**（早期 Spike 结论"透明底不支持"是错的，当时只在 prompt 文字里要求、没试过这个 API 参数），但**与"保持原位置"不可兼得**——要求保持原画布时上游忽略它、返回原尺寸 RGB 白底（`size` 取 1024x1024 与 1024x1536 都一样，已用控制变量法排除 size 是原因）。仍然成立的部分：**不要在 prompt 文字里要求 transparent**（模型会去画棋盘格图案）；落盘前用 `services/image_alpha_utils.white_to_transparent()` 转真透明，**只对 `version=='E'` 生效**（`routers/image_gen.py` 的 `_convert_data_uri_to_transparent`）——普通 POD 设计图的白底是设计的一部分，绝不能被扒掉
  - **`white_to_transparent` 的阈值有数据依据，别随手改**：`ALPHA_LO=14 / ALPHA_HI=45`。白底图"离纯白距离"的分位数实测为 50%→9、80%→10、90%→14、95%→101，**背景噪点 ≤14、真实内容 ≥101，中间有干净空档**；LO=6 时背景噪点被当内容、包围盒撑满全图（0.00~1.00），LO=14 起稳定在 0.07~0.92。用**软 alpha + un-premultiply 去白**而非二值抠图——水彩边缘是渐变的，二值化必然留白边或啃边缘；实测白边残留 **0.0%**（合成到红底目视确认）。**2026-08-18 v2 起这套软阈值只作用于背景边缘羽化带（`RIM_PX=4`），不再全局应用**——全局应用会把离白距离恰好落在 14~45 的浅色毛发整片变成半透明（GEN-0175 实测教训，见下条）
  - **抠图判定方向必须是"严判背景，其余全保留"，不是"判定内容"**（2026-08-18 v2 重构，**推翻昨天 v1 的 `FLOOD_WHITE_DIST=40` 宽容差设计**）：v1 的两个机制在真实案例 GEN-0175（奶油色拉布拉多）上同时失效——① 全局软阈值把离白距离 14~45 的浅毛判成半透明；② 宽容差 40 的洪水填充把浅毛也算"白"、指望主体轮廓当屏障，但浅毛边界本身近白、屏障有缺口，洪水漏进主体内部形成整片灰斑（数学指纹验证：存储 alpha 与软阈值公式误差中位数 1.8，确认是本地算法所为而非上游）。v2 判据（`_classify_background`）：背景必须**同时满足**离白距离 ≤ 自适应容差（`_estimate_bg_tol` 四角采样取最干净角的 p99+3，clip 到 [4,12]——实测上游 `background=opaque` 整图背景 p99=2，与最浅内容（距离 ≥5）有干净空档）**且**从画布边缘洪水可达（4 邻接）；环形中心例外照旧（封闭白区 ≥2% 判背景）；其余像素**一律 alpha=255**，软过渡只留在背景膨胀 4px 的羽化带内。实测：GEN-0175 内部斑块 0.30%→**0.000%**，圆环中心仍正确透明，24 张历史图 + 2 张 opaque 整图零回归。**验收必须同时测三类：浅色主体（斑块）、环形元素（中心透明）、细枝叶（间隙不被误填），三类的失败方向互相冲突，只测一类必漏另两类**
  - **画布比例跟随的是"印刷图案"而不是"上传文件"**（2026-08-18 修正，**此前只跟文件比例是错的**）：`GET /api/prompts/elements/{rule_id}` 返回 `source_width/source_height`（Pillow 读原图）+ `artwork_orientation`，前端提交时用它而非固定 1024 方图——抠取要求"保持原比例"，方图会把竖版竞品图挤扁、位置必然错。**但文件比例 ≠ 图案比例**：竞品图常是实物摆拍，RULE-0063 是 2000×2000 方形照片、拍的却是户外灯笼，真正的印刷图案是面板上约 1:2.2 的窄竖条，四周全是灯具外壳与草地虚化背景（用户反馈"元素比例应基于图案而非上传图"）。所以 `rule_extraction` prompt 新增第 2 层 `artwork_orientation` 字段（**只三档粗分类** portrait/landscape/square——精确比例 VLM 给不准，且 `_get_openai_size` 本来只有 1:1 / 3:2 / 2:3 三个桶，粗分类够用），后端 `routers/prompts.py` 的 `_apply_orientation` 按它**重排长短边**（方图文件 + portrait 时无短边可用，按 2:3 构造）。实测 RULE-0063：VLM 输出 `portrait`（未经引导时也自述"实物摆拍、印刷图案是高而窄的竖向长方形"），画布 2000×2000 → 1333×2000，尺寸桶 `1024x1024` → `1024x1536`。字段是 Optional，**旧规则卡取不到时回落文件比例**，行为与改动前一致。结果网格用 `object-contain` + **棋盘格底衬**（`CHECKER_STYLE`，CSS 渐变不引图片）——透明 PNG 放在白/深色卡片上都看不出哪里是透明的
  - **两个抠取模板的画布措辞必须锚定"印刷图案区域"，否则与校正后的画布请求自相矛盾**：旧措辞 `same aspect ratio and framing as the provided image` 让模型对齐**整张照片**——当后端已按 `artwork_orientation` 请求竖版画布时，一句要方一句要竖，模型只能二选一。改为 `same aspect ratio and framing as the printed artwork area of the provided image (if the image is a product photo, this is the artwork panel only, not the whole photograph)`，与模板第 4 段"忽略画框/实物语境"同向加强。**擦除模板与替换模板都要改**（两处措辞一致）
  - **元素清单只出图形元素**：`extract_element_list` 末尾过滤掉 `is_text_slot` 的项（2026-08-17 用户确认口径："只看图中的构建元素"）。文字类（名字/年份/纪念文案 + "名字文字区"这类描述位）抠出来只是一段字、且抠字极易糊，不进清单；但 `is_text_slot` 的**解析仍然必需**——它就是这里的过滤依据
  - **第3层 original/alternatives 的语言钉死中文，英文候选名走翻译附注**（2026-08-18）：prompt 只钉维度名不钉值时，上游换后端会输出**中英字段全英文**的漂移卡（RULE-0070 `original='softball'` 且 `original_en='softball'`，中文源头缺失）。①源头：`rule_extraction` 明确 original/alternatives 必须中文、英文只进 `*_en`——**唯一例外 `is_text_slot=true`**，文字槽位的 original 是图上原文（名字/年份/英文标语）必须照抄不翻译；②存量兜底：元素端点调 `translate_element_labels`（复用版本C `get_option_translation_prompt` 同款机制）对不含 CJK 的候选名做**一次**批量翻译，写 `label_translated` 供前端显示 `english（中文）`。全中文/纯数字标签零 AI 调用，无 AI/失败静默跳过；**元素端点契约由"纯同步不调 AI"放宽为"必要时一次翻译调用"**。翻译结果不落盘（每次加载现翻，同版本C 行为）
  - **生图任务记录从不自动清理，"消失"是分页默认值**：磁盘全量保留，`GET /api/gen/tasks` 默认 `page_size=20` 只返回最新 20 条——一次元素变体生成就是 20 条，正好把旧记录挤出第一页（2026-08-18 用户误以为被清理）。前端 gen 页用"⬇ 加载更多"按页追加，**不能一次拉全量**（`image_urls` 含 base64 大图，全量是几十 MB）。⚠️ `loadTasks` 加了 `pageArg` 参数后，`onClick={loadTasks}` 这种直接引用会把**点击事件对象当页码**传进去——改回调签名必须排查所有调用点改成 `() => loadTasks(1)`。删除任务时 `total` 同步减一；状态筛选是前端过滤"已加载的任务"，未加载页的任务要先加载更多才会出现
  - **真正要生成的是"每个维度下的每个候选变体"，不是只抠原图那一个元素**（2026-08-17 用户澄清）：每个元素带 `variants` 数组 = `original`（走擦除模板，图里本来就有）+ 各 `alternatives`（走 `ELEMENT_VARIANT_PROMPT_TEMPLATE` 替换模板，图里没有需要"换出来"）。一个维度 6 个候选 = 6 张同位置/同姿态/同风格的透明底素材，用户叠换即得 6 个变体设计。**替换模板与擦除模板的差别**：`REPLACE it with {variant}` + 强调"必须占据完全相同的位置/尺寸/取景"（只说"换成猫"模型会重新构图，一组变体之间就不通用了）+ `pose_clause`（仅当规则卡有**成句英文描述**时才加，第3层的 `value_cn` 常常就是个短标签如"金毛犬"，拿它当姿态说明毫无信息量）+ 风格锁定改为"与原图中**该元素**的渲染风格一致"（变体要和原设计其他元素放一起，风格得对齐原元素而非某种画风）
  - **中文维度名判重（防线①-d，`_cn_name_overlaps`）三级判定**：第2层与第3层描述同一位置时**英文措辞可能毫无重叠**，词级判重（①-c）挡不住——实测 `宠物类型='Golden retriever'`（第3层）与 `主体宠物肖像区='A front-facing half-body portrait of a single pet…'`（第2层）实词交集为空，但中文名都含"宠物"。漏判的后果比多抠一张更糟：第2层项没有 `alternatives`，会在界面上多出一个"只有 1 个候选"的重复维度干扰勾选。**一级**剥结构性后缀取核心名做子串比对（**后缀表顺序关键：长词必须排在其短后缀之前**——若 `型` 先于 `造型` 被剥掉，`尾巴造型` 会变成 `尾巴造`，与 `人鱼尾巴` 失去子串关系，实测踩过）；**二级**共享实体名词（`_ENTITY_NOUNS`）+ 同义/上下位词组（`_ENTITY_SYNONYM_GROUPS`）——挡 `花卉风格` vs `花卉装饰`（修饰词位置不同，互不为子串）与 `点缀昆虫='紫色蝴蝶'` vs `蝴蝶点缀`（上位词 vs 下位词，字面无重叠且英文 `butterflies`/`butterfly` 因粗糙去复数也对不上，三道防线原本全漏）；**三级**共享角色词（`_ROLE_WORDS`，主体/中心/角色/装饰/点缀…）——挡 `主体角色` vs `主体恐龙形象`、`中心主体角色` vs `中心运动员形象`，收紧条件防误伤：须共享 ≥2 个角色词，或共享 1 个且有一方去掉角色词后为空（= 纯泛化槽位）。实测 19 组用例全对（11 组真重复全挡住 + 8 组不同元素零误判，含 `海龟前景角色` vs `前景植物装饰` 这类只共享 1 个角色词但两边都有实义的），全库维度数 213→198
  - **抽象属性判定里"实体名词优先于抽象关键词"（`_is_abstract_dimension`）**：抽象关键词表含"风格/配色/构图"等，但它们在维度名里**可能只是修饰词**——实测 RULE-0067 的 `边框花卉风格`（画面里真实存在的花卉边框、带 4 个候选变体）因名字带"风格"被整个判为抽象属性丢掉，界面上只剩第2层那个没有候选的 `花卉边框装饰区`，表现为"元素变体素材与可变维度下拉框内容不一致"（用户实测反馈）。所以命中抽象关键词后要再看名字里有没有实体名词（`_ENTITY_NOUNS`），有则不判抽象。真正的抽象维度（`整体色彩风格`/`排版布局`/`画面氛围`）不含实体词，不受影响；`背景色='纯白背景'` 仍由"纯色底按值判断"那条挡住。**改这两个函数必须同时跑"真重复要挡住"和"不同元素不能误判"两组用例**，只测一组会往另一个方向翻车
  - **元素清单三道去重 + 两类排除**（`extract_element_list`）：第2/3 层常记录同一元素，光靠 key/子串去重挡不住。防线①-a 槽位名同名、①-b 描述含已收集值（`_get_pod_hints` 同款）、**①-c 词级重叠判重**（`_is_semantic_duplicate`，实词集合重叠率 ≥0.7 按较短一方算——实测 `尾巴造型='Glowing blue-green scaled tail'` 与 `人鱼尾巴='A long scaled mermaid tail in blue-green tones…'` 无子串关系但重叠 100%，而"鱼群+水母+海龟"整组 vs 单独"左下角海龟"只 40%，阈值能分开）、防线② 全列表按 `value_for_prompt` 保序去重。排除两类不可抠项：**抽象属性**（`_is_abstract_dimension`，风格/配色/氛围/构图，按**维度名**判断）与**纯色底**（按**值**判断而非按名——`背景光效='水下阳光光束'` 名字带"背景"但确实可抠，不能误伤）。实测 RULE-0043 从两层 12 项去到 7 项
  - **文字位判断走 `_looks_like_text_slot`**：显式 `is_text_slot` 字段优先，**缺失时按关键词兜底**（与 `_get_pod_hints` 同一份 `_TEXT_SLOT_KEYWORDS`）——旧规则卡整卡都没有 `is_text_slot` 字段，只认字段会把"名字/日期"当普通图案元素（排序错、默认勾选错）
  - **`POST /api/gen/download-zip` 返回裸 zip 二进制，不走 `{success, data}` 包装格式**（下载类端点的既定例外）。前端**不能用 `apiPost`**（会 `response.json()` 直接崩），必须原生 `fetch` 取 `res.blob()`。幂等：已下载过的复用 `task.local_images` 不重复拉远端；单任务失败跳过不中断，全空才 400；zip 内文件名带 `task_id` 前缀防同名覆盖
- **元素拆分入口是按钮触发（三期阶段四，用户补充需求）**: 元素拆分是低频功能（只有个别产品用得到），`ElementExtractSection` 默认**只渲染一行入口按钮、零请求、不渲染面板**（`activated` state 初始 false）；点击才并行取元素清单 + `getSupportsReference()`。无竞品原图时按钮直接置灰（纯 props 判断 `ruleCard.source_images`，零请求）。入口按钮只负责激活与加载，**绝不自动开始生成**——生成必须"勾选元素 → 点生成"二次确认（每个元素一次付费调用，默认全不勾）。已加载过的清单在收起再展开时不重复请求
- **版本B 多套设计方案（三期阶段三）**: `generate_version_b(..., num_directions=1)`。**N=1 是零回归路径**——`get_recommendation_prompt` 的单套文本与改造前逐字符一致（多方案走 `_get_multi_recommendation_prompt` 新分支），返回形状仍是旧的扁平 dict；N>1 返回 `{"directions": [...], "num_directions": N}`。四条约定：
  - **组装逻辑抽成 `_assemble_version_b_direction`**，单套与多套共用同一份，保证两条路径产出的字段**逐字段一致**（前端 `PromptDisplay` 直接消费，形状不能有差异）。改动组装逻辑时两条路径同时生效，不用改两处
  - **`customization_slots` 与"选哪套方案"无关**，多方案 prompt 要求 AI 在**顶层只输出一份**（不在每套里重复，省 token 也避免几套之间不一致），后端算一次塞进每套结果，`PromptDisplay` 无需改动
  - **`_random_recommend_multi` 轮转降级**：第 i 套每个维度取 `alternatives[i % len(alternatives)]`（空 alternatives 回落 original），只要某维度候选 >1 各套就天然不同，不会给出 N 套一模一样。三种触发：无 AI（reason 写"随机轮转推荐"）/ AI 调用失败 / AI 返回格式异常（后两者 reason 前缀注明降级原因）。AI 有效项**不足 N 时照常返回实际条数**（记 warning，不报错不降级）
  - **旧规则卡（无 `alternatives_en`）的多方案英文提示词会相同**——`_append_english` 的中文泄漏防线会把含 CJK 的替换值丢弃，导致几套的英文提示词退化成同一份。**这是既有限制不是本次引入**（中文结构化提示词与 `recommended_changes` 仍各套不同，前端方案卡片能看出差异）。新分析的规则卡都带 `_en`，三套提示词确实不同
- **版本B 前端多方案（三期阶段三）**: `PromptVersionB.tsx` 按响应形状分流——`Array.isArray(data.directions)` 走多方案，否则走与改造前一致的单 `result` 渲染。三条约定：
  - **`key={activeIdx}` 强制重挂载 `PromptDisplay`**：切换方案时内部的 `editablePositive/editableEdit`、可定制项勾选、生图状态全部重置为该方案初始值，不会串味。代价是**切换会丢弃该方案下的手动编辑**，UI 已明示
  - **决策点 3：展现形式不变**——当前方案仍走同一个 `PromptDisplay`（中文结构化提示词/生图提示词/可定制项/单方案生图区全都一样），只在它上方多一列方案卡片，A/B/C 三栏布局不动，版本C 同屏可正常操作
  - **批量生成已合并进「生成图片」区**（2026-08-17 用户反馈：原为独立 `CollapsibleSection`，与生图区各有一套尺寸下拉/附带原图开关，重复且割裂）。现在 `PromptDisplay` 收一个可选 `batchMode?: {directions, checkedIdx}` prop（只有版本B 多方案传，其他版本不传=没有 tab），`ImageGenSection` 内部 `genMode: 'single' | 'batch'` 切换：**尺寸与"附带竞品原图"两个模式共用**（改一处两边都生效），切 tab 只换专属控件（数量按钮组、添加参考图仅单张模式）与结果区。
  - **批量结果直接在区内看图**：`POST /api/gen/submit` 在同步模式（`api_type=openai`）下**返回时就带 `image_urls`**（后端 `_submit_one` 的 `is_sync_completed` 分支），所以批量模式**不需要轮询**——直接渲染缩略图网格 + 点击大图预览（复用同一个 `previewUrl` 遮罩）+ 每张 `⬇ 下载`（调 `POST /api/gen/download/{task_id}` 取 `accessible_paths[0]` 再用隐藏 `<a download>` 触发）。异步模式（aireiter）此时无图，占位提示去生图任务页。**单张模式仍走轮询**（它可能 count>1 且需要跟踪进度），两条路径互不影响
  - **批量生成栏的范围边界**：只用各方案的**原始**提示词，**不含可定制项勾选与手动编辑**（栏内小字明示，需要这些切到「🎯 单张精修」，那里用的是编辑区当前方案的提示词）。提交**串行**（OpenAI 图片 API 限流严，并发会集体 429，同后端 #8）。批量模式的编辑指令判断是 `attachRuleImage && 所有勾选方案都有 image_prompt_edit`——缺一套就整批回落完整描述模式并提示
- **`lib/genConfig.ts`（三期阶段三提取）**: `getSupportsReference()` / `getCachedSupportsReference()`，原本是 `PromptDisplay.tsx` 里的模块级 `_supportsReferenceCache`，因批量生成栏也要用而提取。同款模块缓存 + 并发去重（做法同 `lib/userPrefs.ts`）；失败返回 false（保守当作不支持、回落纯文本生图）且**不写缓存**以便重试
- **`lib/sizePresets.ts` 新增共用函数（三期阶段三）**: `clampToApiMax(w,h)`（等比缩放到 1600 内，超限才缩）、`buildSizeOptions(customPresets)`（内置 + 自定义预设的下拉选项）、`resolveSizeByValue(value, customPresets)`（按选中值解析宽高，找不到返回 null 让调用方保持当前值）。生图区与批量生成栏共用，避免两处各写一遍缩放/合并逻辑算错
- **规则卡批量删除（三期追加需求5）**: `POST /api/rules/batch-delete`（body `{rule_ids: List[str]}`，上限 `BATCH_DELETE_MAX=100`）。用 **POST + 子资源路径而非 `DELETE` 带 body**——部分代理/客户端对带 body 的 DELETE 支持不一致，且这是"批量操作"语义。实现是**串行逐个复用已有的 `delete_rule()`**（删除逻辑的单一事实来源，含"先读 JSON 取 `source_images`/`thumbnail_path` 再删文件"的关键顺序），**单条失败不中断整批**，响应把结果分成三类：`deleted` / `not_found`（`delete_rule` 返回 False）/ `failed`（抛异常，带 `error`）。不需要加锁：`unlink(missing_ok=True)` 与 `DELETE WHERE` 都幂等，且单进程下本请求内串行（与 `rule_store` 本身无锁的既有约定一致）

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
- **尺寸预设单一事实来源（三期阶段一）**: `lib/sizePresets.ts` 导出 `PRODUCT_SIZE_PRESETS`（17 个内置预设）/`API_MAX_SIZE`(1600)/`CUSTOM_SIZE_PREFIX`(`'custom:'`)，从 `PromptDisplay.tsx` 抽出（那里只留 `gcd`/`calcRatioText`）。自定义预设在下拉框的 value 必须带 `CUSTOM_SIZE_PREFIX` 前缀，防与内置 value 撞车；`handlePresetChange` 按前缀分流去 `customPresets` 查宽高
- **用户偏好前端层（三期阶段一）**: `lib/userPrefs.ts` 是后端 `/api/prefs` 的读写层，**与 `lib/localStorage.ts` 是两回事**——后者存版本C 按规则卡隔离的维度自定义值（跟着规则卡走、浏览器本地），前者存全局产品名/尺寸（跟着人走、落后端，换浏览器不丢）。模块级 `_cache` + `_inflight` 并发去重（A/B/C 三栏各挂一个 ProductSelect + ImageGenSection，只发一次 GET；做法同 `_supportsReferenceCache`）。写操作分两类语义：`addCustomProductIfNew`/`saveLastSize` 是 **fire-and-forget**（调用方不 await，失败只 `console.warn`，绝不拖慢/阻断生成与生图），`addCustomSize` 用户主动点击**故意抛错**让 UI 显示原因，`removeCustomProduct`/`removeCustomSize` 失败回退当前缓存值。`fetchPrefs` 失败返回空默认值且**不写缓存**（下次挂载可重试）
- **生图尺寸恢复的 touchedRef 守卫（三期阶段一）**: `ImageGenSection` 挂载时异步 `fetchPrefs()` 恢复 `last_size`，但用户可能在偏好返回前就改了尺寸——`touchedRef` 记录"用户动过任一尺寸控件"，动过就不再覆盖。恢复时 **width/height 才是权威值**，`last_size.preset` 只是"当时从哪个下拉项来的"：preset 在内置/自定义预设中都找不到（预设已被删）时 `setSizePreset('')` 退回手动模式，宽高照常恢复，不报错。宽高输入是连续触发的，`saveLastSize` 走 500ms debounce 且**新值直接当参数传进 `scheduleSaveLastSize`，不读闭包 state**（否则存进去的是中间态）
- **批量分析队列（三期阶段二，纯前端、后端零改动）**: `analyze/page.tsx` 的 `PageState` 加 `'batch'`。入口分流在 `handleFilesSelect`：`files.length === 1` 走原单图全流程（ready 确认→分析→人工预览→**手动**保存→原地展开提示词，一行不改），`>= 2` 进批量队列（上限 `BATCH_MAX=20`，超出截断并提示）。批量语义与单图**故意不同**：分析成功即**自动保存**入库（决策点 4），完成项收起为紧凑行，队列自动跑下一张。
  - **必须串行（并发=1）**：后端 `ImageAnalyzer.analyze` 内部已是 2 路 VLM 并行（SABC + 6 层拆解 `asyncio.gather`），前端再并发会叠成 4~6 路撞上游限流。固定决策，不做并发开关。
  - **权威队列在 `batchItemsRef`，`batchItems` state 只是渲染镜像**（唯一写入口 `writeBatchItems` / `patchBatchItem` 同时改两者）。原因：执行循环是跑几十分钟的 async 函数，闭包读 state 永远是启动那刻的旧值；而"在 `setState` 更新函数里 `resolve` 一个 promise 取当前值"在 **React StrictMode（Next.js dev 默认开）下会被双调用**，属不纯更新函数会取到错乱值。`stopFlagRef` 同理用 ref。
  - **循环语义是"处理所有 queued 项"**，所以重试只需把某项置回 `queued` 再启动同一个 `runBatchQueue`，不用另写重试逻辑；`runningRef` 防连点重复启动。
  - **ESLint 规则约束**：`react-hooks/set-state-in-effect` 禁止在 effect 体内同步 setState、`Cannot access refs during render` 禁止渲染期读 ref。所以 per-item 计时器改成"事件上下文里 `setItemStartAt(Date.now())`，effect 只起 interval"；"停止中"按钮禁用态用 `stopping` state 而非读 `stopFlagRef.current`
  - **继续添加图片（三处入口）**: `BATCH_MAX=10`（2026-08-17 从 20 调整）。批量 ready/running/done 三态都渲染追加上传区（`handleAppendFiles` 追加进现有队列不清空），单图 ready 态的追加（`handleAddFromReady`）会把"已选那张 + 新加的"一起 `buildBatch` 转批量。**运行中追加会自动排到队尾被跑掉**——执行循环每轮重新从 ref 找 `queued` 项，天然支持，不用额外唤醒逻辑。**追加项 id 必须用"现有最大 id +1"，不能用数组长度**——移除中间某项后长度会与仍存在的 id 撞车（同后端递增 ID 的 scan-max 教训）。追加按剩余额度 `BATCH_MAX - 现有张数` 裁剪。配套 `handleRemoveItem` 只允许移除 `queued` 项并 revoke 其 Object URL（有追加就必须能删，否则误加一张只能整批重来）
- **`FileUpload` 多选模式（三期阶段二）**: 新增可选 `multiple` + `onFilesSelect`（收到本次选择的全部 `image/*` 文件，只选 1 张也是长度 1 的数组，由父组件分流）。**不传 `multiple` 时行为与改造前完全一致**（单文件 `onFileSelect` + 组件内预览缩略图），所以 `PromptDisplay` 的"添加参考图"不受影响——改动此组件时必须同时验证这两个调用处。multiple 模式下不在组件内做预览（父组件用网格展示，避免重复），且 `input.value` 在 change 后清空（否则再选同一批文件不触发 change）
- **规则库选择模式（三期追加需求5）**: `RuleCardList.tsx` 内的 `selectMode`（不新建组件，与单张删除同处维护）。三条约定：
  - **"全选/反选"只作用于 `filteredRules`（当前筛选+搜索结果），不是全库** —— 用户按 C 级筛选后点全选，预期是"选中这些 C 级卡"。按钮文案显式写出条数（`全选当前 N 条`）避免误解；勾选状态在筛选条件变化时**保留不清空**（删除确认文案用 `selectedIds.size`，用户看到的始终是真实待删数）
  - **选择模式下不渲染 `<Link>`，改渲染带 `role="checkbox"` 的 `<div>`**（点卡片=勾选），而不是靠 `e.preventDefault()` 拦跳转——避免"看起来是链接但点了不跳"误导键盘/读屏用户。单张 `🗑` 在选择模式下隐藏，防两套删除入口并存误触
  - **删除结果处理：`deleted` 和 `not_found` 都要从列表移除，只有 `failed` 保留**。`not_found` 意味着后端已经没有这条了（别处已删），留在界面上是幽灵卡片、点进去只会 404；`failed` 才是"卡还在、这次没删掉"，保留下来用户可重试。（此点是验收时实测发现的缺陷，原实现只移除 `deleted`）。请求整体失败时**不做乐观更新**，列表保持不动，避免"界面删了实际没删"

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
