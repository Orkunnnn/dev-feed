export interface FeedSource {
  id: string;
  name: string;
  feedUrl: string;
  website: string;
  color: string;
  includeCategories?: string[];
}

export const feedSources: FeedSource[] = [
  {
    id: "openai",
    name: "OpenAI",
    feedUrl: "https://openai.com/news/rss.xml",
    website: "https://openai.com/news",
    color: "#10a37f",
    includeCategories: ["Engineering"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    feedUrl: "https://blog.cloudflare.com/rss",
    website: "https://blog.cloudflare.com",
    color: "#f6821f",
  },
  {
    id: "stripe",
    name: "Stripe",
    feedUrl: "https://stripe.com/blog/feed.rss",
    website: "https://stripe.com/blog",
    color: "#635bff",
  },
  {
    id: "netflix",
    name: "Netflix",
    feedUrl: "https://netflixtechblog.com/feed",
    website: "https://netflixtechblog.com",
    color: "#e50914",
  },
  {
    id: "github",
    name: "GitHub",
    feedUrl: "https://github.blog/engineering.atom",
    website: "https://github.blog/category/engineering",
    color: "#24292f",
  },
];
