import Link from "next/link";

/* 导航卡片数据 */
const navCards = [
  {
    emoji: "⚙️",
    title: "模型配置",
    description: "配置 AI 模型参数和 API 密钥",
    href: "/settings",
  },
  {
    emoji: "📸",
    title: "分析竞品图",
    description: "上传竞品图片，AI 自动拆解设计规则",
    href: "/analyze",
  },
  {
    emoji: "📋",
    title: "规则库",
    description: "浏览和管理已拆解的设计规则",
    href: "/rules",
  },
  {
    emoji: "📚",
    title: "自有图库",
    description: "管理你的自有图片资源库",
    href: "/library",
  },
  {
    emoji: "🎨",
    title: "生图任务",
    description: "管理 AI 生图任务和结果",
    href: "/gen",
  },
];

/* 首页组件：系统标题 + 导航卡片 */
export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      {/* 系统标题 */}
      <h1 className="text-3xl font-bold text-codex-text mb-2">
        竞品图案规则拆解系统
      </h1>
      <p className="text-codex-text-secondary mb-12">
        AI 驱动的竞品图案分析与提示词生成
      </p>

      {/* 导航卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-4xl">
        {navCards.map((card) => (
          <Link key={card.href} href={card.href}>
            <div className="group flex flex-col items-center p-6 rounded-lg bg-codex-card border border-codex-border transition-all duration-200 hover:border-codex-accent hover:shadow-lg hover:shadow-codex-accent/10 cursor-pointer">
              {/* 图标 */}
              <span className="text-4xl mb-4">{card.emoji}</span>
              {/* 标题 */}
              <h2 className="text-lg font-semibold text-codex-text group-hover:text-codex-accent transition-colors">
                {card.title}
              </h2>
              {/* 描述 */}
              <p className="text-sm text-codex-text-secondary mt-2 text-center">
                {card.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
