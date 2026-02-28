"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Inbox, Search } from "lucide-react";
import type { Article } from "@/types/feed";
import {
  DEFAULT_READ_ARCHIVE_DAYS,
  pruneReadTimestamps,
  rankAndFilterArticlesForDeveloperFeed,
} from "@/lib/feed-policy";
import { cn } from "@/lib/utils";
import { SourceFilter } from "./source-filter";
import { ArticleReader } from "./article-reader";
import { InboxRow } from "./inbox-row";
import { useFeedContext } from "./feed-provider";
import { useArticleHeaderContext } from "./article-header-context";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { prefetchArticleContent } from "@/lib/article-content-client-cache";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "./ui/empty";

interface Props {
  articles: Article[];
}

type InboxFolder = "feed" | "bookmarks";
type ReadArticlesStorage = Record<string, number> | string[];
type ReadLaterEntry = { article: Article; savedAt: number };
type ReadLaterStorage = Record<string, ReadLaterEntry>;
type DeletedArticlesStorage = string[];
type ArticleStatusStorage = Record<string, "archived">;

interface PendingDeleteUndo {
  key: string;
  article: Article;
  readAt?: number;
  readLaterEntry?: ReadLaterEntry;
}

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

function normalizeReadStorageValue(value: ReadArticlesStorage): Record<string, number> {
  if (Array.isArray(value)) {
    const now = Date.now();
    return Object.fromEntries(value.map((key) => [key, now]));
  }

  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, readAt]) => Number.isFinite(readAt) && readAt > 0)
  );
}

function normalizeStatusStorageValue(value: ArticleStatusStorage): ArticleStatusStorage {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, status]) => status === "archived")
  );
}

function createArticleSnapshot(article: Article): Article {
  return {
    id: article.id,
    title: article.title,
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    sourceColor: article.sourceColor,
    sourceFeedUrl: article.sourceFeedUrl,
    readingTimeLabel: article.readingTimeLabel,
    authorName: article.authorName,
    authorAvatarUrl: article.authorAvatarUrl,
    link: article.link,
    publishedAt: article.publishedAt,
    excerpt: article.excerpt,
    categories: article.categories,
  };
}

function createPlaceholderReadLaterArticleFromKey(key: string): Article | null {
  const separatorIndex = key.indexOf("::");
  if (separatorIndex === -1) {
    return null;
  }

  const keyPrefix = key.slice(0, separatorIndex);
  const link = key.slice(separatorIndex + 2);
  if (!link.startsWith("http://") && !link.startsWith("https://")) {
    return null;
  }

  return {
    id: key,
    title: link,
    sourceId: keyPrefix || "bookmarks",
    sourceName: "Bookmarks",
    sourceColor: "#6b7280",
    sourceFeedUrl:
      keyPrefix.startsWith("http://") || keyPrefix.startsWith("https://")
        ? keyPrefix
        : undefined,
    link,
    publishedAt: new Date(0).toISOString(),
    excerpt: "",
    categories: [],
  };
}

function normalizeReadLaterStorageValue(value: ReadLaterStorage): ReadLaterStorage {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries: Array<[string, ReadLaterEntry]> = [];

  for (const [key, rawEntry] of Object.entries(value)) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const maybeEntry = rawEntry as Partial<ReadLaterEntry>;
    const maybeArticle = maybeEntry.article as Article | undefined;

    if (!maybeArticle || typeof maybeArticle !== "object") {
      continue;
    }

    if (
      typeof maybeArticle.id !== "string" ||
      typeof maybeArticle.title !== "string" ||
      typeof maybeArticle.sourceId !== "string" ||
      typeof maybeArticle.sourceName !== "string" ||
      typeof maybeArticle.sourceColor !== "string" ||
      typeof maybeArticle.link !== "string" ||
      typeof maybeArticle.publishedAt !== "string" ||
      typeof maybeArticle.excerpt !== "string" ||
      !Array.isArray(maybeArticle.categories)
    ) {
      continue;
    }

    const safeSavedAt =
      typeof maybeEntry.savedAt === "number" && Number.isFinite(maybeEntry.savedAt)
        ? maybeEntry.savedAt
        : 0;

    entries.push([
      key,
      {
        article: createArticleSnapshot(maybeArticle),
        savedAt: safeSavedAt,
      },
    ]);
  }

  return Object.fromEntries(entries);
}

function normalizeDeletedStorageValue(value: DeletedArticlesStorage): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set(
    value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
  );

  return [...unique];
}

function areReadMapsEqual(
  first: Record<string, number>,
  second: Record<string, number>
): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);

  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every((key) => first[key] === second[key]);
}

function normalizeFolder(value: string): InboxFolder {
  if (value === "bookmarks" || value === "read_later" || value === "archived") {
    return "bookmarks";
  }

  return "feed";
}

function matchesSearch(article: Article, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = `${article.title} ${article.excerpt} ${article.sourceName} ${article.authorName || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return haystack.includes(query);
}

export function ArticleList({ articles }: Props) {
  const { customArticles, allSources, isLoadingCustom } = useFeedContext();
  const { setArticleHeaderState, clearArticleHeaderState } =
    useArticleHeaderContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [uncheckedSourceIds, setUncheckedSourceIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    searchParams.get("article")
  );
  const [isDesktop, setIsDesktop] = useState(false);
  const [query, setQuery] = useState("");
  const [activeFolderStorage, setActiveFolder] = useLocalStorage<InboxFolder>(
    "rss-dev-feed-active-folder",
    "feed"
  );
  const [readArticlesStorage, setReadArticlesStorage, isReadStorageHydrated] =
    useLocalStorage<ReadArticlesStorage>("rss-dev-feed-read-articles", {});
  const [readLaterStorage, setReadLaterStorage, isReadLaterHydrated] =
    useLocalStorage<ReadLaterStorage>("rss-dev-feed-read-later-articles", {});
  const [deletedArticlesStorage, setDeletedArticlesStorage] =
    useLocalStorage<DeletedArticlesStorage>("rss-dev-feed-deleted-articles", []);
  const [articleStatusStorage, setArticleStatusStorage, isArticleStatusHydrated] =
    useLocalStorage<ArticleStatusStorage>("rss-dev-feed-article-status", {});
  const [pendingDeleteUndo, setPendingDeleteUndo] =
    useState<PendingDeleteUndo | null>(null);
  const deleteUndoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFolder = normalizeFolder(activeFolderStorage);

  const availableSourceIds = useMemo(
    () => new Set(allSources.map((source) => source.id)),
    [allSources]
  );

  const mergedArticles = useMemo(
    () =>
      [...articles, ...customArticles].filter((article) =>
        availableSourceIds.has(article.sourceId)
      ),
    [articles, customArticles, availableSourceIds]
  );

  const getArticleReadKey = useCallback((article: Article): string => {
    const normalizedLink = normalizeComparableUrl(article.link);
    if (normalizedLink && article.sourceFeedUrl) {
      return `${article.sourceFeedUrl}::${normalizedLink}`;
    }

    if (normalizedLink) {
      return `${article.sourceId}::${normalizedLink}`;
    }

    return article.id;
  }, []);

  const readArticleTimestampsByKey = useMemo(
    () => normalizeReadStorageValue(readArticlesStorage),
    [readArticlesStorage]
  );

  const readLaterEntriesByKey = useMemo(
    () => normalizeReadLaterStorageValue(readLaterStorage),
    [readLaterStorage]
  );

  const deletedArticleKeys = useMemo(
    () => new Set(normalizeDeletedStorageValue(deletedArticlesStorage)),
    [deletedArticlesStorage]
  );

  const legacyArticleStatusByKey = useMemo(
    () => normalizeStatusStorageValue(articleStatusStorage),
    [articleStatusStorage]
  );

  const clearDeleteUndoTimeout = useCallback(() => {
    if (!deleteUndoTimeoutRef.current) {
      return;
    }

    clearTimeout(deleteUndoTimeoutRef.current);
    deleteUndoTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncDesktopState = () => {
      setIsDesktop(mediaQuery.matches);
    };

    syncDesktopState();
    mediaQuery.addEventListener("change", syncDesktopState);

    return () => {
      mediaQuery.removeEventListener("change", syncDesktopState);
    };
  }, []);

  useEffect(() => {
    return clearDeleteUndoTimeout;
  }, [clearDeleteUndoTimeout]);

  useEffect(() => {
    if (!isReadStorageHydrated) {
      return;
    }

    const now = new Date();
    const normalized = normalizeReadStorageValue(readArticlesStorage);
    const pruned = pruneReadTimestamps(
      normalized,
      now,
      DEFAULT_READ_ARCHIVE_DAYS
    );

    const readDeleteThresholdMs =
      now.getTime() - DEFAULT_READ_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
    const expiredReadKeys = Object.entries(normalized)
      .filter(([, readAt]) => readAt < readDeleteThresholdMs)
      .map(([key]) => key);

    if (expiredReadKeys.length > 0) {
      setDeletedArticlesStorage((prev) => {
        const normalizedDeleted = normalizeDeletedStorageValue(prev);
        const unique = new Set(normalizedDeleted);
        let changed = false;

        for (const key of expiredReadKeys) {
          if (unique.has(key)) {
            continue;
          }

          unique.add(key);
          changed = true;
        }

        if (!changed) {
          return normalizedDeleted;
        }

        return [...unique].slice(0, 5000);
      });
    }

    if (Array.isArray(readArticlesStorage) || !areReadMapsEqual(normalized, pruned)) {
      setReadArticlesStorage(pruned);
    }
  }, [
    isReadStorageHydrated,
    readArticlesStorage,
    setDeletedArticlesStorage,
    setReadArticlesStorage,
  ]);

  useEffect(() => {
    if (activeFolderStorage === activeFolder) {
      return;
    }

    setActiveFolder(activeFolder);
  }, [activeFolder, activeFolderStorage, setActiveFolder]);

  useEffect(() => {
    if (!isReadLaterHydrated || !isArticleStatusHydrated) {
      return;
    }

    const legacyKeys = Object.keys(legacyArticleStatusByKey);
    if (legacyKeys.length === 0) {
      return;
    }

    const articlesByKey = new Map(
      mergedArticles.map((article) => [getArticleReadKey(article), article])
    );

    setReadLaterStorage((prev) => {
      const normalized = normalizeReadLaterStorageValue(prev);
      let changed = false;
      const next: ReadLaterStorage = { ...normalized };

      for (const key of legacyKeys) {
        if (deletedArticleKeys.has(key)) {
          continue;
        }

        if (next[key]) {
          continue;
        }

        const sourceArticle = articlesByKey.get(key);
        if (sourceArticle) {
          next[key] = {
            article: createArticleSnapshot(sourceArticle),
            savedAt: Date.now(),
          };
          changed = true;
          continue;
        }

        const fallbackArticle = createPlaceholderReadLaterArticleFromKey(key);
        if (!fallbackArticle) {
          continue;
        }

        next[key] = {
          article: fallbackArticle,
          savedAt: Date.now(),
        };
        changed = true;
      }

      return changed ? next : normalized;
    });

    setArticleStatusStorage({});
  }, [
    getArticleReadKey,
    isArticleStatusHydrated,
    isReadLaterHydrated,
    deletedArticleKeys,
    legacyArticleStatusByKey,
    mergedArticles,
    setArticleStatusStorage,
    setReadLaterStorage,
  ]);

  const rankedArticles = useMemo(
    () => rankAndFilterArticlesForDeveloperFeed(mergedArticles, allSources),
    [mergedArticles, allSources]
  );

  const isArticleRead = useCallback(
    (article: Article): boolean => {
      const key = getArticleReadKey(article);
      return Number.isFinite(readArticleTimestampsByKey[key]);
    },
    [getArticleReadKey, readArticleTimestampsByKey]
  );

  const isArticleDeleted = useCallback(
    (article: Article): boolean => {
      const key = getArticleReadKey(article);
      return deletedArticleKeys.has(key);
    },
    [deletedArticleKeys, getArticleReadKey]
  );

  const isArticleSavedForLater = useCallback(
    (article: Article): boolean => {
      const key = getArticleReadKey(article);
      return key in readLaterEntriesByKey;
    },
    [getArticleReadKey, readLaterEntriesByKey]
  );

  const visibleRankedArticles = useMemo(
    () => rankedArticles.filter((article) => !isArticleDeleted(article)),
    [isArticleDeleted, rankedArticles]
  );

  const feedArticles = useMemo(() => {
    const unread: Article[] = [];
    const read: Article[] = [];

    for (const article of visibleRankedArticles) {
      if (isArticleSavedForLater(article)) {
        continue;
      }

      if (isArticleRead(article)) {
        read.push(article);
        continue;
      }

      unread.push(article);
    }

    return [...unread, ...read];
  }, [isArticleRead, isArticleSavedForLater, visibleRankedArticles]);

  const readLaterArticles = useMemo(
    () =>
      Object.entries(readLaterEntriesByKey)
        .filter(([key]) => !deletedArticleKeys.has(key))
        .sort((first, second) => second[1].savedAt - first[1].savedAt)
        .map(([, entry]) => entry.article),
    [deletedArticleKeys, readLaterEntriesByKey]
  );

  const folderArticles = useMemo(() => {
    if (activeFolder === "bookmarks") {
      return readLaterArticles;
    }

    return feedArticles;
  }, [activeFolder, feedArticles, readLaterArticles]);

  const selectableArticles = useMemo(() => {
    const byId = new Map<string, Article>();

    for (const article of mergedArticles) {
      if (isArticleDeleted(article)) {
        continue;
      }

      byId.set(article.id, article);
    }

    for (const article of readLaterArticles) {
      if (!byId.has(article.id)) {
        byId.set(article.id, article);
      }
    }

    return [...byId.values()];
  }, [isArticleDeleted, mergedArticles, readLaterArticles]);

  const selectedArticle = useMemo(() => {
    if (!selectedArticleId) return null;

    const exactMatch =
      selectableArticles.find((article) => article.id === selectedArticleId) || null;
    if (exactMatch) return exactMatch;

    const separatorIndex = selectedArticleId.indexOf("::");
    if (separatorIndex === -1) {
      return null;
    }

    const sourceId = selectedArticleId.slice(0, separatorIndex);
    const selectedRawLink = selectedArticleId.slice(separatorIndex + 2);
    const selectedNormalizedLink = normalizeComparableUrl(selectedRawLink);
    if (!selectedNormalizedLink) {
      return null;
    }

    return (
      selectableArticles.find((article) => {
        if (article.sourceId !== sourceId) {
          return false;
        }

        const articleNormalizedLink = normalizeComparableUrl(article.link);
        return articleNormalizedLink === selectedNormalizedLink;
      }) || null
    );
  }, [selectableArticles, selectedArticleId]);

  useEffect(() => {
    const readSelectedArticleId = () => {
      const params = new URLSearchParams(window.location.search);
      return params.get("article");
    };

    const handlePopState = () => {
      setSelectedArticleId(readSelectedArticleId());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const filteredBySource = useMemo(
    () => folderArticles.filter((article) => !uncheckedSourceIds.has(article.sourceId)),
    [folderArticles, uncheckedSourceIds]
  );

  const normalizedQuery = query.toLowerCase().trim();

  const filtered = useMemo(
    () => filteredBySource.filter((article) => matchesSearch(article, normalizedQuery)),
    [filteredBySource, normalizedQuery]
  );

  const readArticleKeysSet = useMemo(
    () => new Set(Object.keys(readArticleTimestampsByKey)),
    [readArticleTimestampsByKey]
  );

  const setArticleReadState = useCallback(
    (article: Article, shouldMarkAsRead: boolean) => {
      const key = getArticleReadKey(article);

      setReadArticlesStorage((prev) => {
        const normalized = normalizeReadStorageValue(prev);

        if (shouldMarkAsRead) {
          if (Number.isFinite(normalized[key])) {
            return normalized;
          }

          const next = {
            ...normalized,
            [key]: Date.now(),
          };

          const topRecentEntries = Object.entries(next)
            .sort(([, firstReadAt], [, secondReadAt]) => secondReadAt - firstReadAt)
            .slice(0, 2000);

          return Object.fromEntries(topRecentEntries);
        }

        if (!(key in normalized)) {
          return normalized;
        }

        const next = { ...normalized };
        delete next[key];
        return next;
      });
    },
    [getArticleReadKey, setReadArticlesStorage]
  );

  const setArticleReadLaterState = useCallback(
    (article: Article, shouldSaveForLater: boolean) => {
      const key = getArticleReadKey(article);

      setReadLaterStorage((prev) => {
        const normalized = normalizeReadLaterStorageValue(prev);

        if (shouldSaveForLater) {
          if (normalized[key]) {
            return normalized;
          }

          const next = {
            ...normalized,
            [key]: {
              article: createArticleSnapshot(article),
              savedAt: Date.now(),
            },
          };

          const limited = Object.entries(next).slice(-2000);
          return Object.fromEntries(limited);
        }

        if (!(key in normalized)) {
          return normalized;
        }

        const next = { ...normalized };
        delete next[key];
        return next;
      });
    },
    [getArticleReadKey, setReadLaterStorage]
  );

  const deleteArticle = useCallback(
    (article: Article) => {
      const key = getArticleReadKey(article);
      const readAt = readArticleTimestampsByKey[key];
      const readLaterEntry = readLaterEntriesByKey[key];

      clearDeleteUndoTimeout();

      setPendingDeleteUndo({
        key,
        article: createArticleSnapshot(article),
        readAt: Number.isFinite(readAt) ? readAt : undefined,
        readLaterEntry,
      });

      deleteUndoTimeoutRef.current = setTimeout(() => {
        setPendingDeleteUndo(null);
        deleteUndoTimeoutRef.current = null;
      }, 5000);

      setDeletedArticlesStorage((prev) => {
        const normalized = normalizeDeletedStorageValue(prev);

        if (normalized.includes(key)) {
          return normalized;
        }

        return [key, ...normalized].slice(0, 5000);
      });

      setReadLaterStorage((prev) => {
        const normalized = normalizeReadLaterStorageValue(prev);
        if (!(key in normalized)) {
          return normalized;
        }

        const next = { ...normalized };
        delete next[key];
        return next;
      });

      setReadArticlesStorage((prev) => {
        const normalized = normalizeReadStorageValue(prev);
        if (!(key in normalized)) {
          return normalized;
        }

        const next = { ...normalized };
        delete next[key];
        return next;
      });
    },
    [
      clearDeleteUndoTimeout,
      getArticleReadKey,
      readArticleTimestampsByKey,
      readLaterEntriesByKey,
      setPendingDeleteUndo,
      setDeletedArticlesStorage,
      setReadArticlesStorage,
      setReadLaterStorage,
    ]
  );

  const undoDelete = useCallback(() => {
    if (!pendingDeleteUndo) {
      return;
    }

    const { key, readAt, readLaterEntry } = pendingDeleteUndo;

    setDeletedArticlesStorage((prev) =>
      normalizeDeletedStorageValue(prev).filter((entry) => entry !== key)
    );

    if (typeof readAt === "number" && Number.isFinite(readAt)) {
      setReadArticlesStorage((prev) => {
        const normalized = normalizeReadStorageValue(prev);
        return {
          ...normalized,
          [key]: readAt,
        };
      });
    }

    if (readLaterEntry) {
      setReadLaterStorage((prev) => {
        const normalized = normalizeReadLaterStorageValue(prev);
        return {
          ...normalized,
          [key]: readLaterEntry,
        };
      });
    }

    clearDeleteUndoTimeout();
    setPendingDeleteUndo(null);
  }, [
    clearDeleteUndoTimeout,
    pendingDeleteUndo,
    setDeletedArticlesStorage,
    setReadArticlesStorage,
    setReadLaterStorage,
  ]);

  function setSourceChecked(id: string, checked: boolean) {
    setUncheckedSourceIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function checkAllSources() {
    setUncheckedSourceIds(new Set());
  }

  const countsBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const article of folderArticles) {
      counts.set(article.sourceId, (counts.get(article.sourceId) || 0) + 1);
    }
    return counts;
  }, [folderArticles]);

  function uncheckAllSources() {
    setUncheckedSourceIds(
      new Set(
        allSources
          .filter((source) => (countsBySource.get(source.id) || 0) > 0)
          .map((source) => source.id)
      )
    );
  }

  const setSelectedArticleInUrl = useCallback(
    (articleId: string | null, method: "push" | "replace" = "push") => {
      const params = new URLSearchParams(window.location.search);

      if (articleId) {
        params.set("article", articleId);
      } else {
        params.delete("article");
      }

      const queryString = params.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;

      if (method === "replace") {
        window.history.replaceState(window.history.state, "", href);
        setSelectedArticleId(articleId);
        return;
      }

      window.history.pushState(window.history.state, "", href);
      setSelectedArticleId(articleId);
    },
    [pathname]
  );

  const handleOpenArticle = useCallback((article: Article) => {
    setArticleReadState(article, true);
    prefetchArticleContent(article.link, article.sourceFeedUrl);
    setSelectedArticleInUrl(article.id, "push");
  }, [setArticleReadState, setSelectedArticleInUrl]);

  useEffect(() => {
    if (!selectedArticle) {
      return;
    }

    setArticleReadState(selectedArticle, true);
  }, [selectedArticle, setArticleReadState]);

  useEffect(() => {
    if (selectedArticle) {
      return;
    }

    for (const article of filtered.slice(0, 4)) {
      prefetchArticleContent(article.link, article.sourceFeedUrl);
    }
  }, [filtered, selectedArticle]);

  const handleBackToFeed = useCallback(() => {
    if (!isDesktop && typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    setSelectedArticleInUrl(null, "replace");
  }, [isDesktop, setSelectedArticleInUrl]);

  useEffect(() => {
    if (!selectedArticle) {
      clearArticleHeaderState();
      return;
    }

    setArticleHeaderState({
      isArticleActive: true,
      articleLink: selectedArticle.link,
      onBack: handleBackToFeed,
    });
  }, [
    clearArticleHeaderState,
    handleBackToFeed,
    selectedArticle,
    setArticleHeaderState,
  ]);

  useEffect(() => clearArticleHeaderState, [clearArticleHeaderState]);

  const feedCount = feedArticles.length;
  const readLaterCount = readLaterArticles.length;

  const folders: Array<{
    id: InboxFolder;
    label: string;
    count: number;
    icon: typeof Inbox;
  }> = [
    { id: "feed", label: "Feed", count: feedCount, icon: Inbox },
    { id: "bookmarks", label: "Bookmarks", count: readLaterCount, icon: Bookmark },
  ];

  const shouldCenterEmptyState =
    isDesktop && (activeFolder === "bookmarks" || Boolean(normalizedQuery));

  const listPane = (
    <section
      className={cn(
        "min-w-0 overflow-hidden border bg-card",
        isDesktop ? "flex h-full flex-col" : undefined
      )}
    >
      <div data-header-compact-trigger className="border-b bg-muted/30 p-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8"
              placeholder="Search feed"
              aria-label="Search feed"
            />
          </div>

          <SourceFilter
            sources={allSources}
            uncheckedSourceIds={uncheckedSourceIds}
            counts={countsBySource}
            onSetSourceChecked={setSourceChecked}
            onCheckAll={checkAllSources}
            onUncheckAll={uncheckAllSources}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <p>{`${filtered.length} of ${folderArticles.length} messages`}</p>
          {isLoadingCustom && customArticles.length === 0 ? (
            <p>Syncing custom feeds...</p>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "overflow-y-auto",
          isDesktop ? "min-h-0 flex-1" : "max-h-[calc(100dvh-12.5rem)]"
        )}
      >
        {filtered.length === 0 ? (
          <div
            className={cn(
              "p-3",
              shouldCenterEmptyState ? "flex h-full items-center justify-center" : undefined
            )}
          >
            <Empty
              className={cn(
                "border border-dashed",
                shouldCenterEmptyState ? "w-full max-w-xl" : undefined
              )}
            >
              <EmptyHeader className="text-center">
                <EmptyTitle>
                  {activeFolder === "feed" ? "No articles" : "No bookmarks"}
                </EmptyTitle>
                <EmptyDescription>
                  {normalizedQuery
                    ? "No results match your search."
                    : activeFolder === "feed"
                      ? "New engineering updates will appear here when they arrive."
                      : "Bookmarked items stay here until you remove them."}
                </EmptyDescription>
              </EmptyHeader>
              {activeFolder === "feed" && !normalizedQuery ? (
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={checkAllSources}>
                    Reset source filters
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          </div>
        ) : (
          <>
            {filtered.map((article) => {
              const isRead = isReadStorageHydrated
                ? readArticleKeysSet.has(getArticleReadKey(article))
                : false;
              const isSavedForLater = isArticleSavedForLater(article);

              return (
                <InboxRow
                  key={article.id}
                  article={article}
                  isSelected={selectedArticle?.id === article.id}
                  isRead={isRead}
                  isSavedForLater={isSavedForLater}
                  onPrefetch={() => prefetchArticleContent(article.link, article.sourceFeedUrl)}
                  onSelect={() => handleOpenArticle(article)}
                  onToggleRead={() => setArticleReadState(article, !isRead)}
                  onToggleSavedForLater={() => {
                    const nextSavedForLater = !isSavedForLater;
                    setArticleReadLaterState(article, nextSavedForLater);

                    const shouldClearSelection =
                      selectedArticle?.id === article.id &&
                      ((nextSavedForLater && activeFolder !== "bookmarks") ||
                        (!nextSavedForLater && activeFolder === "bookmarks"));

                    if (shouldClearSelection) {
                      setSelectedArticleInUrl(null, "replace");
                    }
                  }}
                  onDelete={() => {
                    deleteArticle(article);

                    if (selectedArticle?.id === article.id) {
                      setSelectedArticleInUrl(null, "replace");
                    }
                  }}
                />
              );
            })}
          </>
        )}
      </div>
    </section>
  );

  const foldersRail = (
    <aside className="min-w-0 overflow-hidden border bg-card p-2 lg:sticky lg:top-24 lg:h-fit">
      <p className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Folders
      </p>

      <div className="space-y-1">
        {folders.map((folder) => {
          const Icon = folder.icon;

          return (
            <Button
              key={folder.id}
              variant={activeFolder === folder.id ? "secondary" : "ghost"}
              className="h-9 w-full justify-start"
              onClick={() => setActiveFolder(folder.id)}
            >
              <Icon className="mr-2 size-4" />
              <span>{folder.label}</span>
              <Badge variant="secondary" className="ml-auto">
                {folder.count}
              </Badge>
            </Button>
          );
        })}
      </div>

    </aside>
  );

  const undoToast = pendingDeleteUndo ? (
    <div className="fixed bottom-4 right-4 z-30 border bg-background px-3 py-2 shadow-sm">
      <div className="flex items-center gap-3 text-xs">
        <p className="max-w-[16rem] truncate text-muted-foreground">
          Deleted: {pendingDeleteUndo.article.title}
        </p>
        <Button size="sm" variant="secondary" onClick={undoDelete}>
          Undo
        </Button>
      </div>
    </div>
  ) : null;

  if (selectedArticle) {
    return (
      <div className="mx-auto w-full max-w-5xl animate-in fade-in slide-in-from-right-4 duration-300">
        <ArticleReader article={selectedArticle} onBack={handleBackToFeed} />
      </div>
    );
  }

  if (selectedArticleId && !selectedArticle) {
    return (
      <div className="animate-in fade-in duration-200 min-h-[calc(100vh-12rem)] flex items-center justify-center px-4">
        <Empty className="max-w-md border">
          <EmptyHeader className="text-center">
            <EmptyTitle>
              {isLoadingCustom ? "Loading article" : "Article unavailable"}
            </EmptyTitle>
            <EmptyDescription className="text-center">
              {isLoadingCustom
                ? "We are still syncing your feeds."
                : "This link no longer matches an article in your current feeds."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              className="hover:cursor-pointer"
              onClick={() => setSelectedArticleInUrl(null, "replace")}
            >
              Back to feed
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <>
        <div className="animate-in fade-in duration-200 space-y-3">
          <div className="overflow-x-auto pb-1">
            <div className="inline-flex gap-2">
              {folders.map((folder) => {
                const Icon = folder.icon;

                return (
                  <Button
                    key={folder.id}
                    variant={activeFolder === folder.id ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setActiveFolder(folder.id)}
                  >
                    <Icon className="mr-1.5 size-3.5" />
                    {folder.label}
                    <Badge variant="secondary" className="ml-1.5">
                      {folder.count}
                    </Badge>
                  </Button>
                );
              })}
            </div>
          </div>

          {listPane}
        </div>
        {undoToast}
      </>
    );
  }

  return (
    <>
      <div className="animate-in fade-in duration-200 grid gap-3 lg:h-[calc(100dvh-10rem)] lg:grid-cols-[13rem_minmax(0,1fr)]">
        {foldersRail}
        {listPane}
      </div>
      {undoToast}
    </>
  );
}
