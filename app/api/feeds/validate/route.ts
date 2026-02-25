import https from "node:https";
import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import type { Article, ValidateFeedResponse } from "@/types/feed";
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

    const feed = await parser.parseURL(feedUrl);

    const feedHostname = new URL(feedUrl).hostname.toLowerCase();
    const name = feed.title?.trim() || feedHostname;
    const website = feed.link || feedUrl;
    const openaiAuthorFallback =
      feedHostname === "openai.com" || feedHostname.endsWith(".openai.com")
        ? "OpenAI"
        : undefined;

    const articles: Article[] = (feed.items || []).slice(0, 30).map((item) => {
      const readingTimeLabel = extractFeedReadTimeLabel(item as Record<string, unknown>);
      const authorName = extractFeedAuthorName(item as Record<string, unknown>);
      const resolvedAuthorName = authorName || openaiAuthorFallback;
      const rawExcerpt = item.contentSnippet || item.summary || "";
      const excerpt = excerptFromRawContent(rawExcerpt);

      return {
        id: `custom::${item.guid || item.link || item.title || ""}`,
        title: decodeHtmlEntities(item.title?.trim() || "Untitled").trim() || "Untitled",
        sourceId: "",
        sourceName: name,
        sourceColor: "",
        sourceFeedUrl: feedUrl,
        readingTimeLabel,
        authorName: resolvedAuthorName,
        link: item.link || website,
        publishedAt: item.isoDate || item.pubDate || new Date(0).toISOString(),
        excerpt,
        categories: item.categories || [],
      };
    });

    return NextResponse.json({
      success: true,
      feed: { name, website, feedUrl, articles },
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
