export interface FeedSource {
  id: string;
  name: string;
  feedUrl: string;
  website: string;
  color: string;
  isYouTube?: boolean;
  includeShorts?: boolean;
  includeLive?: boolean;
  tier?: "core" | "normal" | "explore";
  lookbackDays?: number;
  maxUnreadVisible?: number;
  priority?: number;
  includeCategories?: string[];
  excludeCategories?: string[];
  excludeKeywords?: string[];
}

export const feedSources: FeedSource[] = [
  {
    id: "openai",
    name: "OpenAI",
    feedUrl: "https://openai.com/news/rss.xml",
    website: "https://openai.com/news",
    color: "#10a37f",
    tier: "core",
    lookbackDays: 14,
    maxUnreadVisible: 3,
    priority: 18,
    includeCategories: ["Engineering"],
    excludeKeywords: ["launch", "pricing", "event"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    feedUrl: "https://blog.cloudflare.com/rss",
    website: "https://blog.cloudflare.com",
    color: "#f6821f",
    tier: "core",
    lookbackDays: 14,
    maxUnreadVisible: 3,
    priority: 16,
    excludeKeywords: ["webinar", "event", "customer story"],
  },
  {
    id: "stripe",
    name: "Stripe",
    feedUrl: "https://stripe.com/blog/feed.rss",
    website: "https://stripe.com/blog",
    color: "#635bff",
    tier: "normal",
    lookbackDays: 14,
    maxUnreadVisible: 2,
    priority: 12,
    excludeKeywords: ["launch", "pricing", "customer story"],
  },
  {
    id: "netflix",
    name: "Netflix",
    feedUrl: "https://netflixtechblog.com/feed",
    website: "https://netflixtechblog.com",
    color: "#e50914",
    tier: "core",
    lookbackDays: 14,
    maxUnreadVisible: 3,
    priority: 17,
    excludeKeywords: ["event", "announcement"],
  },
  {
    id: "github",
    name: "GitHub",
    feedUrl: "https://github.blog/engineering.atom",
    website: "https://github.blog/category/engineering",
    color: "#24292f",
    tier: "explore",
    lookbackDays: 7,
    maxUnreadVisible: 2,
    priority: 10,
    includeCategories: ["Engineering"],
    excludeKeywords: ["webinar", "customer story", "event"],
  },
];
