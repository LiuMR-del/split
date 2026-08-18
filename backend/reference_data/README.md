# reference_data —— AI 分析的参照标准

这个目录放的是**随项目分发的参照数据**，不是用户数据。

与 `backend/data/` 的区别：
- `backend/data/` = 用户跑出来的东西（规则卡、生图任务、上传图、API Key），大部分在 `.gitignore` 里，**别人 clone 下来是空的**
- `backend/reference_data/` = **必须入库**。AI 判断品类要靠它，缺了就退回瞎猜——移植到别的机器上得能直接用

## amazon_categories.json

亚马逊 US 站的**叶子（最小）类目**清单，供 VLM 判断竞品图印在什么产品上时对照。

| 字段 | 说明 |
|---|---|
| `node_id` | 亚马逊 browse node id |
| `name_en` / `name_cn` | 类目名（`name_cn` 只对 `is_pod=true` 的项翻译，其余 5700 条留空——翻译全部不值那个 token） |
| `path` | 完整层级路径，如 `Home & Kitchen/Bedding/Blankets & Throws` |
| `depth` / `dept` | 层级深度 / 所属部门 |
| `is_pod` | **是否 POD 印花载体**（毛毯/T恤/马克杯这类能印图案的） |
| `pod_categories` | 归属的载体大类，如 `["毛毯"]` |

规模：6363 个叶子类目，其中 653 个是 POD 印花载体。

## 数据是怎么来的（要更新时照做）

**不要去爬亚马逊榜单页**——递归到叶子要 3000~6000 个请求、2~4 小时，还有被限流的风险。
亚马逊官方就发布现成的类目树文件：

1. 登录**卖家中心** → 帮助 → 搜 `Browse Tree Guide`（分类树指南 / BTG）
   直达：`https://sellercentral.amazon.com/help/hub/reference/G201951010`
2. 下载 US 站这三份 `.xls`（POD 载体 95% 集中在这里）：
   - **家居厨具**（home-kitchen）→ 毛毯、抱枕、挂画、桌布、浴帘、地垫
   - **服装和配饰**（fashion）→ T恤、卫衣、帽子、袜子、围裙、托特包
   - **艺术品、工艺品和缝纫用品**（arts-and-crafts）→ 海报、贴纸、手作
3. 解析：数据在第 2 张工作表（表名以 `us-` 开头），两列有用——`Node ID`、`Node Path`
   - **叶子判定**：某条 path 不是任何其他 path 的前缀，它就是叶子
   - `.xls` 是旧版 OLE2 格式，得用 `xlrd==2.0.1`，openpyxl 读不了

BTG 需要卖家账号登录，无法自动化下载（SP-API 也没有导出类目树的接口——它是卖家运营 API，只有按 ASIN 反查所属类目）。所以更新时要人工下载那三个文件。

## 关联：vocabularies/product_type.json

那份**受控词表**（51 项）就是从本文件的 653 个 POD 叶子归并 + 人工校订来的，是 VLM 实际填 `layer_4_product` 时的选项表。改词表前先看这里的原始类目。

归并时踩过的坑，改的时候注意：
- 关键词匹配要用**词边界**——`cap`/`pod`/`tee` 会把 `Chimney Caps`（烟囱帽）、`Coffee Pods`（咖啡胶囊）、`Teeth Boxes`（乳牙盒）全捞进来
- 要排**配件五金**——`Shower Curtain Hooks/Rings/Rods`（浴帘挂钩/环/杆）不是印花载体

数据日期：2026-08-18（BTG 文件版本 us-home-kitchen 23.01.2025 / us-fashion 11.08.2026 / us-arts-and-crafts 13.08.2026）
