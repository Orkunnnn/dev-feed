import { NextRequest, NextResponse } from "next/server";
import { fetchFeedsByUrls } from "@/lib/fetch-feeds";
import type { FeedSource } from "@/config/feeds";

export async function POST(request: NextRequest) {
  try {
    const { sources } = (await request.json()) as { sources: FeedSource[] };

    if (!Array.isArray(sources) || sources.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    if (sources.length > 20) {
      return NextResponse.json(
        { error: "Maximum 20 custom feeds allowed" },
        { status: 400 }
      );
    }

    const articles = await fetchFeedsByUrls(sources);
    return NextResponse.json({ articles });
  } catch (error) {
    console.error("Failed to fetch custom feeds:", error);
    return NextResponse.json(
      { articles: [], error: "Failed to fetch feeds" },
      { status: 500 }
    );
  }
}
