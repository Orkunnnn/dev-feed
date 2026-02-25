import https from "node:https";
import Parser from "rss-parser";
import { feedSources, type FeedSource } from "@/config/feeds";
import type { Article, FeedFetchResult } from "@/types/feed";
import {
  decodeHtmlEntities,
  extractFeedAuthorName,
  extractFeedReadTimeLabel,
} from "@/lib/utils";

function excerptFromRawContent(rawContent: string): string {
  if (!rawContent) return "";

  const withoutLeadingLinkedInAuthors = rawContent.replace(
    /^\s*<p>\s*(?:<a[^>]*href=["'][^"']*linkedin\.com\/in\/[^"']*["'][^>]*>[\s\S]*?<\/a>\s*[,\s]*){2,}[\s\S]*?<\/p>/i,
    ""
  );

  return decodeHtmlEntities(withoutLeadingLinkedInAuthors.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const agent = new https.Agent({ rejectUnauthorized: false });

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "RSSDevFeed/1.0",
  },
  requestOptions: { agent },
});

function getOpenAIAuthorFallback(source: FeedSource): string | undefined {
  try {
    const hostname = new URL(source.website).hostname.toLowerCase();
    if (hostname === "openai.com" || hostname.endsWith(".openai.com")) {
      return "OpenAI";
    }
  } catch {
    // no-op
  }

  return undefined;
}

function matchesSourceCategoryFilter(item: Parser.Item, source: FeedSource): boolean {
  const includeCategories = source.includeCategories;
  if (!includeCategories || includeCategories.length === 0) {
    return true;
  }

  const allowedCategories = new Set(
    includeCategories
      .map((category) => category.trim().toLowerCase())
      .filter(Boolean)
  );

  if (allowedCategories.size === 0) {
    return true;
  }

  return (item.categories || []).some((category) =>
    allowedCategories.has(category.trim().toLowerCase())
  );
}

function normalizeArticle(item: Parser.Item, source: FeedSource): Article {
  const readingTimeLabel = extractFeedReadTimeLabel(item as Record<string, unknown>);
  const authorName = extractFeedAuthorName(item as Record<string, unknown>);
  const resolvedAuthorName = authorName || getOpenAIAuthorFallback(source);
  const rawExcerpt = item.contentSnippet || item.summary || "";
  const excerpt = excerptFromRawContent(rawExcerpt);

  return {
    id: `${source.id}::${item.guid || item.link || item.title || ""}`,
    title: decodeHtmlEntities(item.title?.trim() || "Untitled").trim() || "Untitled",
    sourceId: source.id,
    sourceName: source.name,
    sourceColor: source.color,
    sourceFeedUrl: source.feedUrl,
    readingTimeLabel,
    authorName: resolvedAuthorName,
    link: item.link || source.website,
    publishedAt: item.isoDate || item.pubDate || new Date(0).toISOString(),
    excerpt,
    categories: item.categories || [],
  };
}

export async function fetchSingleFeed(
  source: FeedSource
): Promise<FeedFetchResult> {
  try {
    const feed = await parser.parseURL(source.feedUrl);
    const articles = (feed.items || [])
      .filter((item) => matchesSourceCategoryFilter(item, source))
      .slice(0, 30)
      .map((item) => normalizeArticle(item, source));
    return { sourceId: source.id, articles };
  } catch (error) {
    console.error(`Failed to fetch feed: ${source.name}`, error);
    return {
      sourceId: source.id,
      articles: [],
      error: `Failed to fetch ${source.name}`,
    };
  }
}

export async function fetchFeedsByUrls(
  sources: FeedSource[]
): Promise<Article[]> {
  const results = await Promise.allSettled(
    sources.map((source) => fetchSingleFeed(source))
  );

  const articles: Article[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value.articles);
    }
  }

  articles.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return articles;
}

export async function fetchAllFeeds(): Promise<Article[]> {
  const results = await Promise.allSettled(
    feedSources.map((source) => fetchSingleFeed(source))
  );

  const articles: Article[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value.articles);
    }
  }

  articles.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return articles;
}
