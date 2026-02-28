"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FeedSource } from "@/config/feeds";
import { feedSources as defaultFeedSources } from "@/config/feeds";
import type {
  Article,
  CustomFeedSource,
  ValidateFeedResponse,
} from "@/types/feed";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { getNextColor } from "@/lib/feed-colors";
import { normalizeFeedUrlForComparison } from "@/lib/youtube";

interface FeedContextType {
  customFeeds: CustomFeedSource[];
  allSources: FeedSource[];
  customArticles: Article[];
  isLoadingCustom: boolean;
  addFeed: (feedUrl: string) => Promise<{ success: boolean; error?: string }>;
  updateFeedPreferences: (
    feedId: string,
    preferences: Partial<Pick<CustomFeedSource, "includeShorts" | "includeLive">>
  ) => void;
  removeFeed: (feedId: string) => void;
}

const FeedContext = createContext<FeedContextType | null>(null);

export function useFeedContext() {
  const context = useContext(FeedContext);
  if (!context) {
    throw new Error("useFeedContext must be used within a FeedProvider");
  }
  return context;
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const [customFeeds, setCustomFeeds, isHydrated] = useLocalStorage<
    CustomFeedSource[]
  >("rss-dev-feed-custom-sources", []);
  const [removedDefaultFeedIds, setRemovedDefaultFeedIds] = useLocalStorage<
    string[]
  >("rss-dev-feed-removed-default-sources", []);
  const [customArticles, setCustomArticles] = useState<Article[]>([]);
  const [isLoadingCustom, setIsLoadingCustom] = useState(false);

  const defaultSources = useMemo(
    () =>
      defaultFeedSources.filter(
        (source) => !removedDefaultFeedIds.includes(source.id)
      ),
    [removedDefaultFeedIds]
  );

  const allSources: FeedSource[] = useMemo(
    () => [...defaultSources, ...customFeeds],
    [defaultSources, customFeeds]
  );

  // Fetch custom feed articles after hydration
  useEffect(() => {
    if (!isHydrated || customFeeds.length === 0) return;

    let cancelled = false;

    async function fetchCustomArticles() {
      setIsLoadingCustom(true);
      try {
        const response = await fetch("/api/feeds/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: customFeeds }),
        });
        const data = await response.json();
        if (!cancelled) {
          setCustomArticles(data.articles || []);
        }
      } catch (error) {
        console.error("Failed to fetch custom feeds:", error);
      } finally {
        if (!cancelled) {
          setIsLoadingCustom(false);
        }
      }
    }

    fetchCustomArticles();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, customFeeds]);

  const addFeed = useCallback(
    async (feedUrl: string) => {
      const response = await fetch("/api/feeds/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl }),
      });

      const data: ValidateFeedResponse = await response.json();

      if (!data.success || !data.feed) {
        return { success: false, error: data.error || "Unknown error" };
      }

      const normalizedIncomingFeedUrl = normalizeFeedUrlForComparison(
        data.feed.feedUrl
      );
      const hasDuplicate = allSources.some(
        (source) =>
          normalizeFeedUrlForComparison(source.feedUrl) ===
          normalizedIncomingFeedUrl
      );

      if (hasDuplicate) {
        return { success: false, error: "This feed is already added" };
      }

      const id = `custom-${Date.now()}`;
      const usedColors = allSources.map((s) => s.color);
      const color = getNextColor(usedColors);

      const newFeed: CustomFeedSource = {
        id,
        name: data.feed.name,
        feedUrl: data.feed.feedUrl,
        website: data.feed.website,
        color,
        isYouTube: data.feed.isYouTube,
        includeShorts: data.feed.includeShorts,
        includeLive: data.feed.includeLive,
        isCustom: true,
      };

      // Stamp articles with source info
      const stampedArticles = data.feed.articles.map((a) => ({
        ...a,
        id: `${id}::${a.id.replace("custom::", "")}`,
        sourceId: id,
        sourceName: newFeed.name,
        sourceColor: color,
      }));

      setCustomFeeds((prev) => [...prev, newFeed]);
      setCustomArticles((prev) => {
        const merged = [...prev, ...stampedArticles];
        merged.sort(
          (a, b) =>
            new Date(b.publishedAt).getTime() -
            new Date(a.publishedAt).getTime()
        );
        return merged;
      });

      return { success: true };
    },
    [allSources, setCustomFeeds]
  );

  const updateFeedPreferences = useCallback(
    (
      feedId: string,
      preferences: Partial<Pick<CustomFeedSource, "includeShorts" | "includeLive">>
    ) => {
      setCustomFeeds((prev) =>
        prev.map((feed) => {
          if (feed.id !== feedId) {
            return feed;
          }

          return {
            ...feed,
            ...preferences,
          };
        })
      );
    },
    [setCustomFeeds]
  );

  const removeFeed = useCallback(
    (feedId: string) => {
      const isCustom = customFeeds.some((feed) => feed.id === feedId);

      if (isCustom) {
        setCustomFeeds((prev) => prev.filter((f) => f.id !== feedId));
        setCustomArticles((prev) => prev.filter((a) => a.sourceId !== feedId));
        return;
      }

      setRemovedDefaultFeedIds((prev) => {
        if (prev.includes(feedId)) return prev;
        return [...prev, feedId];
      });
    },
    [customFeeds, setCustomFeeds, setRemovedDefaultFeedIds]
  );

  return (
    <FeedContext.Provider
      value={{
        customFeeds,
        allSources,
        customArticles,
        isLoadingCustom,
        addFeed,
        updateFeedPreferences,
        removeFeed,
      }}
    >
      {children}
    </FeedContext.Provider>
  );
}
