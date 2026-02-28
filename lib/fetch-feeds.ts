import https from "node:https";
import Parser from "rss-parser";
import { feedSources, type FeedSource } from "@/config/feeds";
import type { Article, FeedFetchResult } from "@/types/feed";
import {
  FEED_LOOKBACK_DAYS,
  rankAndFilterArticlesForDeveloperFeed,
} from "@/lib/feed-policy";
import {
  decodeHtmlEntities,
  extractFeedAuthorName,
  extractFeedReadTimeLabel,
} from "@/lib/utils";
import {
  isLikelyYouTubeShort,
  isYouTubeFeedUrl,
  isYouTubeUrl,
  resolveYouTubeFeedUrl,
} from "@/lib/youtube";

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

function isYouTubeSource(source: FeedSource): boolean {
  if (source.isYouTube) {
    return true;
  }

  return isYouTubeFeedUrl(source.feedUrl);
}

function isLikelyYouTubeLiveItem(item: Parser.Item): boolean {
  const title = (item.title || "").toLowerCase();
  const link = (item.link || "").toLowerCase();
  const text = `${item.contentSnippet || ""} ${item.summary || ""}`.toLowerCase();

  return (
    link.includes("/live/") ||
    /\blive\b/.test(title) ||
    /\bpremiere\b/.test(title) ||
    text.includes("live stream") ||
    text.includes("premiere")
  );
}

function shouldKeepYouTubeItem(item: Parser.Item, source: FeedSource): boolean {
  if (!isYouTubeSource(source)) {
    return true;
  }

  const includeShorts = source.includeShorts !== false;
  const includeLive = source.includeLive !== false;

  if (!includeShorts && isLikelyYouTubeShort(item.link || "")) {
    return false;
  }

  if (!includeLive && isLikelyYouTubeLiveItem(item)) {
    return false;
  }

  return true;
}

function normalizeArticle(
  item: Parser.Item,
  source: FeedSource,
  sourceFeedUrl: string
): Article {
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
    sourceFeedUrl,
    readingTimeLabel,
    authorName: resolvedAuthorName,
    link: item.link || source.website,
    publishedAt: item.isoDate || item.pubDate || new Date(0).toISOString(),
    excerpt,
    categories: item.categories || [],
  };
}

function isWithinFetchWindow(publishedAt: string, nowMs: number): boolean {
  const publishedAtMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedAtMs)) {
    return false;
  }

  const ageMs = nowMs - publishedAtMs;
  if (ageMs < 0) {
    return false;
  }

  return ageMs <= FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

export async function fetchSingleFeed(
  source: FeedSource
): Promise<FeedFetchResult> {
  try {
    const resolvedFeedUrl =
      isYouTubeUrl(source.feedUrl) && !isYouTubeFeedUrl(source.feedUrl)
        ? await resolveYouTubeFeedUrl(source.feedUrl)
        : source.feedUrl;
    const feed = await parser.parseURL(resolvedFeedUrl);
    const nowMs = Date.now();
    const normalizedArticles = (feed.items || [])
      .filter((item) => matchesSourceCategoryFilter(item, source))
      .filter((item) => shouldKeepYouTubeItem(item, source))
      .map((item) => normalizeArticle(item, source, resolvedFeedUrl))
      .filter((article) => isWithinFetchWindow(article.publishedAt, nowMs))
      .slice(0, 30);

    const articles = rankAndFilterArticlesForDeveloperFeed(normalizedArticles, [source]);

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

  return rankAndFilterArticlesForDeveloperFeed(articles, sources);
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

  return rankAndFilterArticlesForDeveloperFeed(articles, feedSources);
}
