import https from "node:https";
import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import type { FeedSource } from "@/config/feeds";
import type { Article, ValidateFeedResponse } from "@/types/feed";
import { rankAndFilterArticlesForDeveloperFeed } from "@/lib/feed-policy";
import {
  buildYouTubeChannelFeedUrl,
  extractYouTubeChannelIdFromUrl,
  isYouTubeUrl,
  resolveYouTubeFeedUrl,
} from "@/lib/youtube";
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
  headers: { "User-Agent": "RSSDevFeed/1.0" },
  requestOptions: { agent },
});

const YOUTUBE_LOOKBACK_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isPublishedWithinDays(
  publishedAt: string,
  nowMs: number,
  lookbackDays: number
): boolean {
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) {
    return false;
  }

  const ageMs = nowMs - publishedMs;
  if (ageMs < 0) {
    return false;
  }

  return ageMs <= lookbackDays * MS_PER_DAY;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ValidateFeedResponse>> {
  try {
    const { feedUrl } = await request.json();

    if (!feedUrl || typeof feedUrl !== "string") {
      return NextResponse.json(
        { success: false, error: "Feed URL is required" },
        { status: 400 }
      );
    }

    try {
      new URL(feedUrl);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid URL format" },
        { status: 400 }
      );
    }

    const resolvedFeedUrl = isYouTubeUrl(feedUrl)
      ? await resolveYouTubeFeedUrl(feedUrl)
      : feedUrl;

    const feed = await parser.parseURL(resolvedFeedUrl);

    const canonicalYouTubeChannelId =
      extractYouTubeChannelIdFromUrl(feed.link || "") ||
      extractYouTubeChannelIdFromUrl(resolvedFeedUrl);
    const canonicalFeedUrl = canonicalYouTubeChannelId
      ? buildYouTubeChannelFeedUrl(canonicalYouTubeChannelId)
      : resolvedFeedUrl;
    const isYouTubeFeed = Boolean(canonicalYouTubeChannelId);

    const feedHostname = new URL(canonicalFeedUrl).hostname.toLowerCase();
    const name = feed.title?.trim() || feedHostname;
    const website = feed.link || canonicalFeedUrl;
    const openaiAuthorFallback =
      feedHostname === "openai.com" || feedHostname.endsWith(".openai.com")
        ? "OpenAI"
        : undefined;

    const sourceForValidation: FeedSource = {
      id: "",
      name,
      feedUrl: canonicalFeedUrl,
      website,
      color: "",
      isYouTube: isYouTubeFeed,
      includeShorts: isYouTubeFeed ? true : undefined,
      includeLive: isYouTubeFeed ? true : undefined,
      tier: "normal",
      lookbackDays: 14,
      maxUnreadVisible: 2,
    };

    const normalizedArticles: Article[] = (feed.items || []).slice(0, 30).map((item) => {
      const readingTimeLabel = extractFeedReadTimeLabel(item as Record<string, unknown>);
      const authorName = extractFeedAuthorName(item as Record<string, unknown>);
      const resolvedAuthorName = authorName || openaiAuthorFallback;
      const rawExcerpt = item.contentSnippet || item.summary || "";
      const excerpt = excerptFromRawContent(rawExcerpt);

      return {
        id: `custom::${item.guid || item.link || item.title || ""}`,
        title: decodeHtmlEntities(item.title?.trim() || "Untitled").trim() || "Untitled",
        sourceId: sourceForValidation.id,
        sourceName: name,
        sourceColor: "",
        sourceFeedUrl: canonicalFeedUrl,
        readingTimeLabel,
        authorName: resolvedAuthorName,
        link: item.link || website,
        publishedAt: item.isoDate || item.pubDate || new Date(0).toISOString(),
        excerpt,
        categories: item.categories || [],
      };
    });

    const nowMs = Date.now();
    const lookbackFilteredArticles = isYouTubeFeed
      ? normalizedArticles.filter((article) =>
          isPublishedWithinDays(article.publishedAt, nowMs, YOUTUBE_LOOKBACK_DAYS)
        )
      : normalizedArticles;

    const articles = rankAndFilterArticlesForDeveloperFeed(
      lookbackFilteredArticles,
      [sourceForValidation]
    );

    return NextResponse.json({
      success: true,
      feed: {
        name,
        website,
        feedUrl: canonicalFeedUrl,
        isYouTube: isYouTubeFeed,
        includeShorts: isYouTubeFeed ? true : undefined,
        includeLive: isYouTubeFeed ? true : undefined,
        articles,
      },
    });
  } catch (error) {
    console.error("Feed validation failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch or parse feed. Please check the URL.",
      },
      { status: 422 }
    );
  }
}
