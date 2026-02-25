"use client";

import {
  fetchArticleContent,
  type FetchArticleResult,
} from "@/lib/actions/fetch-article-content";

interface TimedCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ARTICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTICLE_ERROR_CACHE_TTL_MS = 30 * 1000;
const ARTICLE_CACHE_MAX_ENTRIES = 300;

const articleCache = new Map<string, TimedCacheEntry<FetchArticleResult>>();
const inFlight = new Map<string, Promise<FetchArticleResult>>();

function normalizeComparableUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function getCacheKey(url: string, sourceFeedUrl?: string): string {
  const normalizedArticleUrl = normalizeComparableUrl(url) || url;
  const normalizedFeedUrl = sourceFeedUrl
    ? normalizeComparableUrl(sourceFeedUrl) || sourceFeedUrl
    : "";

  return `${normalizedFeedUrl}::${normalizedArticleUrl}`;
}

function getCachedValue(key: string): FetchArticleResult | null {
  const cached = articleCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    articleCache.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedValue(key: string, value: FetchArticleResult): void {
  if (articleCache.has(key)) {
    articleCache.delete(key);
  }

  articleCache.set(key, {
    value,
    expiresAt: Date.now() + ("error" in value ? ARTICLE_ERROR_CACHE_TTL_MS : ARTICLE_CACHE_TTL_MS),
  });

  while (articleCache.size > ARTICLE_CACHE_MAX_ENTRIES) {
    const oldestKey = articleCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }

    articleCache.delete(oldestKey);
  }
}

export function getCachedArticleContent(
  url: string,
  sourceFeedUrl?: string
): FetchArticleResult | null {
  return getCachedValue(getCacheKey(url, sourceFeedUrl));
}

export async function loadArticleContent(
  url: string,
  sourceFeedUrl?: string
): Promise<FetchArticleResult> {
  const key = getCacheKey(url, sourceFeedUrl);
  const cached = getCachedValue(key);
  if (cached) {
    return cached;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const request = fetchArticleContent(url, sourceFeedUrl)
    .then((result) => {
      setCachedValue(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function prefetchArticleContent(url: string, sourceFeedUrl?: string): void {
  void loadArticleContent(url, sourceFeedUrl).catch(() => {
    // Ignore prefetch errors to keep UI responsive.
  });
}
