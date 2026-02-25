"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Article } from "@/types/feed";
import { SourceFilter } from "./source-filter";
import { ArticleCard } from "./article-card";
import { ArticleReader } from "./article-reader";
import { EmptyState } from "./empty-state";
import { useFeedContext } from "./feed-provider";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { prefetchArticleContent } from "@/lib/article-content-client-cache";
import { Button } from "./ui/button";
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

export function ArticleList({ articles }: Props) {
  const { customArticles, allSources, isLoadingCustom } = useFeedContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [uncheckedSourceIds, setUncheckedSourceIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    searchParams.get("article")
  );
  const [readArticleKeys, setReadArticleKeys, isReadStorageHydrated] =
    useLocalStorage<string[]>("rss-dev-feed-read-articles", []);

  const availableSourceIds = useMemo(
    () => new Set(allSources.map((source) => source.id)),
    [allSources]
  );

  const mergedArticles = useMemo(() => {
    const all = [...articles, ...customArticles].filter((article) =>
      availableSourceIds.has(article.sourceId)
    );
    all.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    return all;
  }, [articles, customArticles, availableSourceIds]);

  const selectedArticle = useMemo(() => {
    if (!selectedArticleId) return null;

    const exactMatch =
      mergedArticles.find((article) => article.id === selectedArticleId) || null;
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
      mergedArticles.find((article) => {
        if (article.sourceId !== sourceId) {
          return false;
        }

        const articleNormalizedLink = normalizeComparableUrl(article.link);
        return articleNormalizedLink === selectedNormalizedLink;
      }) || null
    );
  }, [mergedArticles, selectedArticleId]);

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

  const filtered = useMemo(
    () =>
      mergedArticles.filter((article) =>
        !uncheckedSourceIds.has(article.sourceId)
      ),
    [mergedArticles, uncheckedSourceIds]
  );

  const readArticleKeysSet = useMemo(
    () => new Set(readArticleKeys),
    [readArticleKeys]
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

  const markArticleAsRead = useCallback(
    (article: Article) => {
      const key = getArticleReadKey(article);
      setReadArticleKeys((prev) => {
        if (prev.includes(key)) {
          return prev;
        }

        const next = [key, ...prev];
        return next.slice(0, 2000);
      });
    },
    [getArticleReadKey, setReadArticleKeys]
  );

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

  function uncheckAllSources() {
    setUncheckedSourceIds(
      new Set(
        allSources
          .filter((source) => (countsBySource.get(source.id) || 0) > 0)
          .map((source) => source.id)
      )
    );
  }

  function setSelectedArticleInUrl(
    articleId: string | null,
    method: "push" | "replace" = "push"
  ) {
    const params = new URLSearchParams(window.location.search);

    if (articleId) {
      params.set("article", articleId);
    } else {
      params.delete("article");
    }

    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;

    if (method === "replace") {
      window.history.replaceState(window.history.state, "", href);
      setSelectedArticleId(articleId);
      return;
    }

    window.history.pushState(window.history.state, "", href);
    setSelectedArticleId(articleId);
  }

  function handleOpenArticle(article: Article) {
    markArticleAsRead(article);
    prefetchArticleContent(article.link, article.sourceFeedUrl);
    setSelectedArticleInUrl(article.id, "push");
  }

  useEffect(() => {
    if (!selectedArticle) {
      return;
    }

    markArticleAsRead(selectedArticle);
  }, [markArticleAsRead, selectedArticle]);

  useEffect(() => {
    if (selectedArticle) {
      return;
    }

    for (const article of filtered.slice(0, 4)) {
      prefetchArticleContent(article.link, article.sourceFeedUrl);
    }
  }, [filtered, selectedArticle]);

  function handleBackToFeed() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    setSelectedArticleInUrl(null, "replace");
  }

  const countsBySource = new Map<string, number>();
  for (const a of mergedArticles) {
    countsBySource.set(a.sourceId, (countsBySource.get(a.sourceId) || 0) + 1);
  }

  if (selectedArticle) {
    return (
      <ArticleReader
        key={selectedArticle.id}
        article={selectedArticle}
        onBack={handleBackToFeed}
      />
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

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex justify-end">
        <SourceFilter
          sources={allSources}
          uncheckedSourceIds={uncheckedSourceIds}
          counts={countsBySource}
          onSetSourceChecked={setSourceChecked}
          onCheckAll={checkAllSources}
          onUncheckAll={uncheckAllSources}
        />
      </div>
      {isLoadingCustom && customArticles.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Loading custom feeds...
        </p>
      )}
      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 space-y-1">
          {filtered.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              isRead={
                isReadStorageHydrated
                  ? readArticleKeysSet.has(getArticleReadKey(article))
                  : undefined
              }
              onPrefetch={() => prefetchArticleContent(article.link, article.sourceFeedUrl)}
              onSelect={() => handleOpenArticle(article)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
