import type { FeedSource } from "@/config/feeds";
import type { Article } from "@/types/feed";

export const DEFAULT_UNREAD_TOTAL_LIMIT = 20;
export const DEFAULT_READ_ARCHIVE_DAYS = 7;
export const READ_STORAGE_RETENTION_DAYS = 45;
export const FEED_LOOKBACK_DAYS = 7;

const DEFAULT_UNREAD_PER_SOURCE_BY_TIER = {
  core: 3,
  normal: 2,
  explore: 2,
} as const;

const DEFAULT_SOURCE_PRIORITY_BY_TIER = {
  core: 16,
  normal: 10,
  explore: 7,
} as const;

const ENGINEERING_KEYWORDS = [
  "engineering",
  "developer",
  "infrastructure",
  "security",
  "reliability",
  "scalability",
  "performance",
  "database",
  "distributed",
  "architecture",
  "ai",
  "ml",
  "platform",
  "devops",
  "observability",
  "api",
  "cloud",
  "frontend",
  "backend",
  "testing",
  "release",
  "incident",
  "postmortem",
];

const NOISE_KEYWORDS = [
  "launch",
  "pricing",
  "webinar",
  "customer story",
  "event recap",
  "press",
  "announcement",
  "sponsored",
  "ebook",
  "report",
  "case study",
  "q&a",
  "hiring",
];

const DATE_MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeComparableUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const cleanParams = [...url.searchParams.entries()]
      .filter(([key]) => {
        if (key.startsWith("utm_")) return false;
        return !["fbclid", "gclid", "ref", "source"].includes(key);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const params = new URLSearchParams(cleanParams);
    const query = params.toString();
    const pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

    return `${url.origin}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseReadingMinutes(label: string | undefined): number | null {
  if (!label) return null;

  const match = label.match(/(\d{1,3})\s*(?:min|mins|minute|minutes)/i);
  if (!match) return null;

  const minutes = Number.parseInt(match[1], 10);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) {
    return null;
  }

  return minutes;
}

function countKeywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSourceTier(source: FeedSource): "core" | "normal" | "explore" {
  return source.tier ?? "normal";
}

export function resolveLookbackDays(source: FeedSource): number {
  const configured = source.lookbackDays;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, FEED_LOOKBACK_DAYS);
  }

  return FEED_LOOKBACK_DAYS;
}

export function resolveUnreadPerSourceLimit(source: FeedSource): number {
  const tier = resolveSourceTier(source);
  return source.maxUnreadVisible ?? DEFAULT_UNREAD_PER_SOURCE_BY_TIER[tier];
}

function resolveSourcePriorityScore(source: FeedSource): number {
  if (typeof source.priority === "number") {
    return clamp(Math.round(source.priority), 0, 20);
  }

  const tier = resolveSourceTier(source);
  return DEFAULT_SOURCE_PRIORITY_BY_TIER[tier];
}

function ageInDays(publishedAt: string, nowMs: number): number | null {
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) {
    return null;
  }

  return (nowMs - publishedMs) / DATE_MS_PER_DAY;
}

function categoryMatchScore(article: Article, source: FeedSource): number {
  const categories = (article.categories || []).map((category) =>
    normalizeText(category)
  );

  const includeCategories = (source.includeCategories || []).map((category) =>
    normalizeText(category)
  );

  const excludeCategories = (source.excludeCategories || []).map((category) =>
    normalizeText(category)
  );

  let score = 0;

  if (includeCategories.length > 0) {
    const matched = categories.some((category) => includeCategories.includes(category));
    score += matched ? 15 : -8;
  }

  if (
    excludeCategories.length > 0 &&
    categories.some((category) => excludeCategories.includes(category))
  ) {
    score -= 10;
  }

  const semanticText = normalizeText(
    `${article.title} ${article.excerpt} ${(article.categories || []).join(" ")}`
  );
  const positiveHits = countKeywordHits(semanticText, ENGINEERING_KEYWORDS);
  const negativeHits = countKeywordHits(semanticText, NOISE_KEYWORDS);

  score += Math.min(10, positiveHits * 2);
  score -= Math.min(10, negativeHits * 3);

  return clamp(score, -10, 15);
}

function readTimeFitScore(article: Article): number {
  const minutes = parseReadingMinutes(article.readingTimeLabel);
  if (!minutes) {
    return 0;
  }

  if (minutes >= 4 && minutes <= 12) {
    return 8;
  }

  if (minutes >= 2 && minutes <= 20) {
    return 4;
  }

  if (minutes < 2) {
    return -4;
  }

  if (minutes > 30) {
    return -6;
  }

  return -2;
}

function trendBoostScore(source: FeedSource): number {
  const sourceId = source.id.toLowerCase();
  const sourceName = source.name.toLowerCase();
  const website = source.website.toLowerCase();

  if (sourceId.includes("trending") || sourceName.includes("trending")) {
    return 15;
  }

  if (sourceId.includes("github") || sourceName.includes("github") || website.includes("github")) {
    return 6;
  }

  return 0;
}

function titleNoisePenalty(article: Article, source: FeedSource): number {
  const sourceNoiseKeywords = source.excludeKeywords || [];
  const text = normalizeText(`${article.title} ${article.excerpt}`);
  const hits =
    countKeywordHits(text, NOISE_KEYWORDS) +
    countKeywordHits(text, sourceNoiseKeywords.map((keyword) => normalizeText(keyword)));

  return -Math.min(20, hits * 5);
}

export function scoreArticleForDeveloperFeed(
  article: Article,
  source: FeedSource,
  now: Date = new Date()
): number {
  const nowMs = now.getTime();
  const ageDays = ageInDays(article.publishedAt, nowMs);

  if (ageDays === null) {
    return -999;
  }

  const lookbackDays = resolveLookbackDays(source);
  const recency = clamp(40 * (1 - ageDays / lookbackDays), 0, 40);

  return clamp(
    recency +
      resolveSourcePriorityScore(source) +
      categoryMatchScore(article, source) +
      readTimeFitScore(article) +
      trendBoostScore(source) +
      titleNoisePenalty(article, source),
    0,
    100
  );
}

function shouldKeepByLookback(article: Article, _source: FeedSource, now: Date): boolean {
  const ageDays = ageInDays(article.publishedAt, now.getTime());
  if (ageDays === null || ageDays < 0) {
    return false;
  }

  return true;
}

type RankedCandidate = {
  article: Article;
  source: FeedSource;
  score: number;
  publishedAtMs: number;
};

function buildRankedCandidates(
  articles: Article[],
  sources: FeedSource[],
  now: Date
): RankedCandidate[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const dedupedByKey = new Map<string, RankedCandidate>();

  for (const article of articles) {
    const source = sourceById.get(article.sourceId);
    if (!source) {
      continue;
    }

    if (!shouldKeepByLookback(article, source, now)) {
      continue;
    }

    const publishedAtMs = new Date(article.publishedAt).getTime();
    if (!Number.isFinite(publishedAtMs)) {
      continue;
    }

    const score = scoreArticleForDeveloperFeed(article, source, now);
    const normalizedLink = normalizeComparableUrl(article.link);
    const normalizedTitle = normalizeText(article.title);
    const dedupeKey = normalizedLink || (normalizedTitle ? `title:${normalizedTitle}` : `id:${article.id}`);

    const candidate: RankedCandidate = {
      article,
      source,
      score,
      publishedAtMs,
    };

    const existing = dedupedByKey.get(dedupeKey);
    if (!existing) {
      dedupedByKey.set(dedupeKey, candidate);
      continue;
    }

    if (candidate.score > existing.score) {
      dedupedByKey.set(dedupeKey, candidate);
      continue;
    }

    if (candidate.score === existing.score && candidate.publishedAtMs > existing.publishedAtMs) {
      dedupedByKey.set(dedupeKey, candidate);
    }
  }

  return [...dedupedByKey.values()].sort((a, b) => {
    if (b.publishedAtMs !== a.publishedAtMs) {
      return b.publishedAtMs - a.publishedAtMs;
    }

    return b.score - a.score;
  });
}

export function rankAndFilterArticlesForDeveloperFeed(
  articles: Article[],
  sources: FeedSource[],
  options: { now?: Date; maxTotal?: number } = {}
): Article[] {
  const ranked = buildRankedCandidates(articles, sources, options.now ?? new Date());
  const rankedArticles = ranked.map((candidate) => candidate.article);

  if (typeof options.maxTotal === "number" && options.maxTotal >= 0) {
    return rankedArticles.slice(0, options.maxTotal);
  }

  return rankedArticles;
}

export function pruneReadTimestamps(
  readTimestampsByKey: Record<string, number>,
  now: Date = new Date(),
  retentionDays: number = READ_STORAGE_RETENTION_DAYS
): Record<string, number> {
  const retentionThreshold = now.getTime() - retentionDays * DATE_MS_PER_DAY;

  const nextEntries = Object.entries(readTimestampsByKey).filter(([, readAt]) => {
    return Number.isFinite(readAt) && readAt >= retentionThreshold;
  });

  return Object.fromEntries(nextEntries);
}

interface ApplyInboxLimitsOptions {
  sources: FeedSource[];
  includeRead?: boolean;
  readTimestampsByKey?: Record<string, number>;
  getArticleReadKey: (article: Article) => string;
  unreadTotalLimit?: number;
  readArchiveDays?: number;
}

export function applyDeveloperInboxLimits(
  rankedArticles: Article[],
  options: ApplyInboxLimitsOptions
): Article[] {
  const {
    sources,
    includeRead = false,
    readTimestampsByKey = {},
    getArticleReadKey,
    unreadTotalLimit = DEFAULT_UNREAD_TOTAL_LIMIT,
    readArchiveDays = DEFAULT_READ_ARCHIVE_DAYS,
  } = options;

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const unreadCountBySource = new Map<string, number>();
  const nowMs = Date.now();
  const readArchiveThreshold = nowMs - readArchiveDays * DATE_MS_PER_DAY;
  const hardTotalLimit = includeRead
    ? Math.max(unreadTotalLimit * 3, 60)
    : unreadTotalLimit;

  let unreadTotal = 0;
  const selected: Article[] = [];

  for (const article of rankedArticles) {
    const source = sourceById.get(article.sourceId);
    if (!source) {
      continue;
    }

    const key = getArticleReadKey(article);
    const readAt = readTimestampsByKey[key];
    const isRead = Number.isFinite(readAt);

    if (!includeRead && isRead) {
      continue;
    }

    if (isRead && readAt < readArchiveThreshold) {
      continue;
    }

    const unreadPerSourceLimit = resolveUnreadPerSourceLimit(source);
    const sourceUnreadCount = unreadCountBySource.get(source.id) || 0;

    if (!isRead && sourceUnreadCount >= unreadPerSourceLimit) {
      continue;
    }

    if (!isRead && unreadTotal >= unreadTotalLimit) {
      continue;
    }

    selected.push(article);

    if (!isRead) {
      unreadCountBySource.set(source.id, sourceUnreadCount + 1);
      unreadTotal += 1;
    }

    if (!includeRead && unreadTotal >= unreadTotalLimit) {
      break;
    }

    if (selected.length >= hardTotalLimit) {
      break;
    }
  }

  return selected;
}
