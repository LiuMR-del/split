/**
 * R5：版本C 自定义选项的本地持久化工具
 *
 * 版本C 下拉框选"自定义"输入的值，存到浏览器 localStorage，下次打开同一规则卡
 * 时直接出现在下拉框里可点选，不用重新打字。
 *
 * 按 rule_id 隔离存储。但 rule_id 可能被复用（rule_store._generate_rule_id 是
 * scan-max+1，删尾部规则卡再新建会拿到同 rule_id），故额外存 _created_date 标记
 * 归属，加载时校验：created_date 不匹配（新旧规则卡复用同一 rule_id）则丢弃旧值，
 * 避免被删规则卡的自定义值污染新卡。
 *
 * 纯函数模块（非 hook）：本场景是"加载模板时读一次 + 生成时写一次"的事件驱动存取，
 * 不是 state 双向持久化，纯函数更可控易测。
 *
 * 容错：所有操作 typeof window !== 'undefined' 守卫（SSR 安全）；全程 try/catch
 * 静默降级（隐私模式/禁用 localStorage/配额满时返回空数据，不抛错阻断生成）。
 * 读取做严格 shape 校验（只保留值为 string[] 的字段），损坏数据（手动 devtools
 * 编辑/扩展误写）不会让版本C面板加载失败。
 *
 * 已知限制：多标签页同时打开同一规则卡并发写入门丢失更新（read-then-write 非原子），
 * 本场景频率极低，未做跨标签合并。
 */

const KEY_PREFIX = 'split:vc:custom:'; // 命名空间前缀防冲突
const MAX_PER_FIELD = 10; // 每个维度最多保留 10 个历史值，防撑爆
const CREATED_DATE_KEY = '_created_date'; // 归属标记字段，存规则卡 created_date

/** 内部：读取原始存储对象（含 _created_date 标记 + 各维度数组）。
 * 仅做格式容错：非纯对象（含数组型损坏、null、原始值）一律返回 null，
 * 防后续 .filter 崩溃 + JSON.stringify([]) 丢写入。 */
function readRaw(ruleId: string): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + ruleId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null; // 解析失败/存储不可用，静默降级
  }
}

/** 内部：从原始对象严格提取 {field: string[]}——只保留值为 string[] 的字段，
 * 丢弃损坏字段（非数组、元素非字符串），跳过 _created_date 标记。 */
function extractFields(data: Record<string, unknown> | null): Record<string, string[]> {
  if (!data) return {};
  const result: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === CREATED_DATE_KEY) continue;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      // 读取侧也过滤哨兵 __custom__（防 devtools 手动写入的哨兵与下拉框选项撞车），
      // 与 addCustomValue 写入侧过滤一致
      result[k] = v.filter((x) => x !== '__custom__');
    }
  }
  return result;
}

/** 读取某规则卡所有维度的自定义值。
 * createdDate 不匹配（rule_id 被复用、旧规则卡残留）则返回 {}，防污染。 */
export function getCustomValuesForRule(
  ruleId: string,
  createdDate: string,
): Record<string, string[]> {
  // createdDate 为空（ruleCard 无 created_date）时拒绝读取，防所有空规则卡共享存储
  if (!createdDate) return {};
  const data = readRaw(ruleId);
  if (!data) return {};
  if (data[CREATED_DATE_KEY] !== createdDate) return {}; // 新旧规则卡复用 rule_id，丢弃旧值
  return extractFields(data);
}

/** 新增一个自定义值到指定维度（去重，最新在前，截断 MAX_PER_FIELD）。
 * createdDate 用于标记归属规则卡（防 rule_id 复用污染）。 */
export function addCustomValue(
  ruleId: string,
  createdDate: string,
  fieldName: string,
  value: string,
): void {
  if (typeof window === 'undefined') return;
  // createdDate 为空时拒绝写入，防所有空规则卡共享存储
  if (!createdDate) return;
  if (!value || !value.trim()) return;
  const trimmed = value.trim();
  // 拒绝哨兵值，防与下拉框 "__custom__" 选项 value 撞车（React key 冲突 + 选中触发自定义模式）
  if (trimmed === '__custom__') return;
  try {
    const data = readRaw(ruleId);
    // 同一 rule_id 但 created_date 变了（规则卡被删除后复用），清空旧值重新开始
    const fresh = !data || data[CREATED_DATE_KEY] !== createdDate;
    const fields = fresh ? {} : extractFields(data);
    const list = fields[fieldName] || [];
    // 去重后把新值放头部（最新在前）
    const deduped = [trimmed, ...list.filter((v) => v !== trimmed)];
    fields[fieldName] = deduped.slice(0, MAX_PER_FIELD);
    window.localStorage.setItem(
      KEY_PREFIX + ruleId,
      JSON.stringify({ [CREATED_DATE_KEY]: createdDate, ...fields }),
    );
  } catch {
    // 写入失败（配额满/禁用），静默降级，不阻断生成
  }
}

/** 删除某个维度的指定自定义值（预留接口，本需求不做 UI 调用） */
export function removeCustomValue(
  ruleId: string,
  createdDate: string,
  fieldName: string,
  value: string,
): void {
  if (typeof window === 'undefined') return;
  if (!createdDate) return;
  try {
    const data = readRaw(ruleId);
    if (!data || data[CREATED_DATE_KEY] !== createdDate) return;
    const fields = extractFields(data);
    const list = fields[fieldName] || [];
    fields[fieldName] = list.filter((v) => v !== value);
    if (fields[fieldName].length === 0) delete fields[fieldName];
    window.localStorage.setItem(
      KEY_PREFIX + ruleId,
      JSON.stringify({ [CREATED_DATE_KEY]: createdDate, ...fields }),
    );
  } catch {
    // 静默降级
  }
}
