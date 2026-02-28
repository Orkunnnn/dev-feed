const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[0-9A-Za-z_-]{22}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isYouTubeHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "youtube.com" || normalized.endsWith(".youtube.com");
}

function isYouTubeVideoHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "youtu.be" || isYouTubeHostname(normalized);
}

export function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return isYouTubeHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isValidYouTubeChannelId(channelId: string): boolean {
  return YOUTUBE_CHANNEL_ID_PATTERN.test(channelId);
}

function normalizeYouTubeVideoId(videoId: string | null): string | null {
  if (!videoId) {
    return null;
  }

  const trimmed = videoId.trim();
  if (!trimmed || !YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isYouTubeVideoHostname(url.hostname)) {
      return null;
    }

    const normalizedHost = normalizeHostname(url.hostname);

    if (normalizedHost === "youtu.be") {
      const pathSegments = url.pathname.split("/").filter(Boolean);
      return normalizeYouTubeVideoId(pathSegments[0] || null);
    }

    const pathname = url.pathname.replace(/\/+$/, "");

    if (pathname === "/watch") {
      return normalizeYouTubeVideoId(url.searchParams.get("v"));
    }

    const shortsMatch = pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) {
      return normalizeYouTubeVideoId(shortsMatch[1]);
    }

    const liveMatch = pathname.match(/^\/live\/([^/?#]+)/);
    if (liveMatch) {
      return normalizeYouTubeVideoId(liveMatch[1]);
    }

    const embedMatch = pathname.match(/^\/embed\/([^/?#]+)/);
    if (embedMatch) {
      return normalizeYouTubeVideoId(embedMatch[1]);
    }

    return null;
  } catch {
    return null;
  }
}

export function isYouTubeVideoUrl(rawUrl: string): boolean {
  return extractYouTubeVideoId(rawUrl) !== null;
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return "";
  }

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function extractYouTubeChannelIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isYouTubeHostname(url.hostname)) {
      return null;
    }

    const channelIdFromQuery = url.searchParams.get("channel_id");
    if (channelIdFromQuery && isValidYouTubeChannelId(channelIdFromQuery)) {
      return channelIdFromQuery;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    const channelMatch = pathname.match(/^\/channel\/(UC[0-9A-Za-z_-]{22})$/);
    if (channelMatch) {
      return channelMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function buildYouTubeChannelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function extractYouTubeChannelIdFromHtml(html: string): string | null {
  const canonicalChannelMatch = html.match(
    /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/i
  );
  const externalIdMatch = html.match(/"externalId":"(UC[0-9A-Za-z_-]{22})"/);
  const channelPathMatch = html.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/);
  const genericChannelIdMatch = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);

  const channelId =
    canonicalChannelMatch?.[1] ||
    externalIdMatch?.[1] ||
    channelPathMatch?.[1] ||
    genericChannelIdMatch?.[1];

  if (!channelId || !isValidYouTubeChannelId(channelId)) {
    return null;
  }

  return channelId;
}

export async function resolveYouTubeFeedUrl(inputUrl: string): Promise<string> {
  const directChannelId = extractYouTubeChannelIdFromUrl(inputUrl);
  if (directChannelId) {
    return buildYouTubeChannelFeedUrl(directChannelId);
  }

  const parsedUrl = new URL(inputUrl);
  if (!isYouTubeHostname(parsedUrl.hostname)) {
    return inputUrl;
  }

  const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
  const canResolveViaPage =
    pathname.startsWith("/@") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/user/") ||
    pathname === "/";

  if (!canResolveViaPage) {
    return inputUrl;
  }

  const pageUrl = new URL(parsedUrl.toString());
  pageUrl.search = "";
  pageUrl.hash = "";

  const response = await fetch(pageUrl.toString(), {
    headers: { "User-Agent": "RSSDevFeed/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    return inputUrl;
  }

  const html = await response.text();
  const channelId = extractYouTubeChannelIdFromHtml(html);
  if (!channelId) {
    return inputUrl;
  }

  return buildYouTubeChannelFeedUrl(channelId);
}

export function isYouTubeFeedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!isYouTubeHostname(url.hostname)) {
      return false;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    return pathname === "/feeds/videos.xml";
  } catch {
    return false;
  }
}

export function normalizeFeedUrlForComparison(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

    const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const params = new URLSearchParams(sortedParams);
    const query = params.toString();

    return `${url.origin}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return rawUrl.trim();
  }
}

export function isLikelyYouTubeShort(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl);
    if (!isYouTubeHostname(url.hostname)) {
      return false;
    }

    return url.pathname.toLowerCase().startsWith("/shorts/");
  } catch {
    return false;
  }
}
