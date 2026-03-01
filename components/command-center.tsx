"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Plus,
  Rss,
  Search,
  Settings2,
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { Article } from "@/types/feed";
import { useFeedContext } from "@/components/feed-provider";
import { useCommandCenter } from "@/components/command-center-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate } from "@/lib/utils";
import { isYouTubeFeedUrl } from "@/lib/youtube";

interface CommandCenterButtonProps {
  compact?: boolean;
}

type CommandCenterScreen = "home" | "theme" | "feeds" | "search-feeds";

const THEME_OPTIONS = [
  {
    id: "light",
    label: "Light theme",
    description: "Use bright interface colors",
    icon: Sun,
  },
  {
    id: "dark",
    label: "Dark theme",
    description: "Use darker interface colors",
    icon: Moon,
  },
  {
    id: "system",
    label: "System theme",
    description: "Follow your system preference",
    icon: Monitor,
  },
] as const;

type ThemeOptionId = (typeof THEME_OPTIONS)[number]["id"];

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function matchesText(haystack: string, query: string): boolean {
  if (!query) {
    return true;
  }

  return haystack.toLowerCase().includes(query);
}

function matchesArticleQuery(article: Article, query: string): boolean {
  if (!query) {
    return true;
  }

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  const haystack = `${article.title} ${article.excerpt} ${article.sourceName} ${article.authorName || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return tokens.every((token) => haystack.includes(token));
}

export function CommandCenterButton({ compact = false }: CommandCenterButtonProps) {
  const { openCommandCenter } = useCommandCenter();

  return (
    <Button
      variant="ghost"
      size={compact ? "icon-xs" : "icon-sm"}
      className={cn(
        "transition-[width,height,padding,transform] duration-300 ease-out",
        compact ? "scale-95" : "scale-100"
      )}
      onClick={openCommandCenter}
    >
      <Settings2 className="size-4" />
      <span className="sr-only">Open command center</span>
    </Button>
  );
}

export function CommandCenter() {
  const {
    allSources,
    customFeeds,
    addFeed,
    removeFeed,
    updateFeedPreferences,
  } = useFeedContext();
  const {
    isOpen,
    openCommandCenter,
    closeCommandCenter,
    feedSearchQuery,
    setFeedSearchQuery,
    searchableArticles,
  } = useCommandCenter();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const [activeScreen, setActiveScreen] = useState<CommandCenterScreen>("home");
  const [homeQuery, setHomeQuery] = useState("");
  const [themeQuery, setThemeQuery] = useState("");
  const [feedsQuery, setFeedsQuery] = useState("");
  const [searchFeedsQuery, setSearchFeedsQuery] = useState("");
  const [isAddingFeed, setIsAddingFeed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveScreen("home");
    setHomeQuery(feedSearchQuery);
    setThemeQuery("");
    setFeedsQuery("");
    setSearchFeedsQuery(feedSearchQuery);
    setActionError(null);
  }, [feedSearchQuery, isOpen]);

  const activeQuery =
    activeScreen === "theme"
      ? themeQuery
      : activeScreen === "feeds"
        ? feedsQuery
        : activeScreen === "search-feeds"
          ? searchFeedsQuery
        : homeQuery;
  const normalizedThemeQuery = themeQuery.trim().toLowerCase();
  const normalizedFeedsQuery = feedsQuery.trim().toLowerCase();
  const canAddFeed = activeScreen === "feeds" && isHttpUrl(feedsQuery.trim());

  const filteredSources = useMemo(() => {
    return allSources
      .filter((source) => {
        const sourceSearchable = `${source.name} ${source.feedUrl} ${source.website}`;
        return matchesText(sourceSearchable, normalizedFeedsQuery);
      })
      .slice(0, 14);
  }, [allSources, normalizedFeedsQuery]);

  const filteredThemeOptions = useMemo(
    () =>
      THEME_OPTIONS.filter((option) =>
        matchesText(`${option.label} ${option.description}`, normalizedThemeQuery)
      ),
    [normalizedThemeQuery]
  );

  const filteredSearchArticles = useMemo(
    () =>
      searchableArticles
        .filter((article) => matchesArticleQuery(article, searchFeedsQuery.trim()))
        .slice(0, 40),
    [searchFeedsQuery, searchableArticles]
  );

  const customFeedIds = useMemo(
    () => new Set(customFeeds.map((feed) => feed.id)),
    [customFeeds]
  );

  const applyFeedSearch = () => {
    setFeedSearchQuery(searchFeedsQuery.trim());
    closeCommandCenter();
  };

  const clearFeedSearch = () => {
    setFeedSearchQuery("");
    setSearchFeedsQuery("");
    closeCommandCenter();
  };

  const handleAddFeed = async () => {
    if (!canAddFeed || isAddingFeed) {
      return;
    }

    setIsAddingFeed(true);
    setActionError(null);

    try {
      const result = await addFeed(feedsQuery.trim());
      if (!result.success) {
        setActionError(result.error || "Failed to add feed");
        return;
      }

      setFeedsQuery("");
      closeCommandCenter();
    } catch {
      setActionError("Something went wrong while adding this feed");
    } finally {
      setIsAddingFeed(false);
    }
  };

  const handleThemeSelect = (nextTheme: ThemeOptionId) => {
    setTheme(nextTheme);
    closeCommandCenter();
  };

  const openArticleFromSearch = (article: Article) => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set("article", article.id);
    const nextHref = `${window.location.pathname}?${params.toString()}`;

    window.history.pushState(window.history.state, "", nextHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
    closeCommandCenter();
  };

  const openThemeScreen = () => {
    setActiveScreen("theme");
    setThemeQuery("");
  };

  const openSearchFeedsScreen = (seedQuery?: string) => {
    setActiveScreen("search-feeds");
    setSearchFeedsQuery(seedQuery ?? feedSearchQuery);
  };

  const openFeedsScreen = () => {
    setActiveScreen("feeds");
    setFeedsQuery("");
  };

  const returnToHomeScreen = () => {
    setActiveScreen("home");
  };

  const visibleTheme = theme === "system" ? resolvedTheme : theme;

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openCommandCenter();
        } else {
          closeCommandCenter();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[10vh] z-50 w-[min(90vw,44rem)] -translate-x-1/2 overflow-hidden border bg-background shadow-xl outline-none">
          <DialogPrimitive.Title className="sr-only">Command center</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search feed, manage sources, and change app settings.
          </DialogPrimitive.Description>

          <div className="relative border-b px-3 py-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={activeQuery}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (activeScreen === "theme") {
                  setThemeQuery(nextValue);
                } else if (activeScreen === "feeds") {
                  setFeedsQuery(nextValue);
                } else if (activeScreen === "search-feeds") {
                  setSearchFeedsQuery(nextValue);
                } else {
                  setHomeQuery(nextValue);
                }
                if (actionError) {
                  setActionError(null);
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Backspace" &&
                  activeScreen !== "home" &&
                  !activeQuery.trim()
                ) {
                  event.preventDefault();
                  returnToHomeScreen();
                  return;
                }

                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();

                if (activeScreen === "theme") {
                  const firstTheme = filteredThemeOptions[0];
                  if (firstTheme) {
                    handleThemeSelect(firstTheme.id);
                  }
                  return;
                }

                if (activeScreen === "feeds") {
                  if (canAddFeed) {
                    void handleAddFeed();
                  }
                  return;
                }

                if (activeScreen === "search-feeds") {
                  applyFeedSearch();
                  return;
                }

                if (activeScreen === "home") {
                  openSearchFeedsScreen();
                  if (homeQuery.trim()) {
                    setSearchFeedsQuery(homeQuery.trim());
                  }
                }
              }}
              placeholder={
                activeScreen === "theme"
                  ? "Search themes..."
                  : activeScreen === "feeds"
                    ? "Search feeds or paste a feed URL..."
                    : activeScreen === "search-feeds"
                      ? "Search feed and content..."
                      : "Type a command..."
              }
              className="h-10 border-0 bg-transparent pl-9 pr-14 text-base shadow-none focus-visible:ring-0"
            />
            <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              /
            </span>
          </div>

          <div className="max-h-[62vh] overflow-y-auto px-3 py-3 [scrollbar-color:var(--muted-foreground)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/35 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/55">
            {actionError ? (
              <p className="mb-2 text-xs text-destructive">{actionError}</p>
            ) : null}

            {activeScreen === "theme" ? (
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={returnToHomeScreen}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <ChevronLeft className="size-4" />
                    Back
                  </span>
                  <span className="text-xs text-muted-foreground">Commands</span>
                </Button>

                <Separator className="my-2" />

                <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Themes
                </p>

                {filteredThemeOptions.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    No themes match this query.
                  </p>
                ) : (
                  filteredThemeOptions.map((option) => {
                    const Icon = option.icon;
                    const isActive =
                      option.id === "system" ? theme === "system" : visibleTheme === option.id;

                    return (
                      <Button
                        key={option.id}
                        variant="ghost"
                        className="h-auto w-full items-center justify-between px-2 py-2"
                        onClick={() => handleThemeSelect(option.id)}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <Icon className="size-4" />
                          {option.label}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {option.description}
                          {isActive ? <Check className="size-3.5" /> : null}
                        </span>
                      </Button>
                    );
                  })
                )}
              </div>
            ) : activeScreen === "search-feeds" ? (
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={returnToHomeScreen}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <ChevronLeft className="size-4" />
                    Back
                  </span>
                  <span className="text-xs text-muted-foreground">Commands</span>
                </Button>

                <Separator className="my-2" />

                <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Search
                </p>

                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={applyFeedSearch}
                  disabled={!searchFeedsQuery.trim()}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <Search className="size-4" />
                    {searchFeedsQuery.trim()
                      ? `Search feed for \"${searchFeedsQuery.trim()}\"`
                      : "Search feed"}
                  </span>
                  <span className="text-xs text-muted-foreground">Filter articles</span>
                </Button>

                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={clearFeedSearch}
                  disabled={!feedSearchQuery}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <Settings2 className="size-4" />
                    Clear feed search
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {feedSearchQuery ? `Current: ${feedSearchQuery}` : "No active filter"}
                  </span>
                </Button>

                <Separator className="my-3" />

                <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Feed Articles
                </p>

                {filteredSearchArticles.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    No articles match this query.
                  </p>
                ) : (
                  filteredSearchArticles.map((article) => (
                    <Button
                      key={`search-article-${article.id}`}
                      variant="ghost"
                      className="h-auto w-full items-start justify-between gap-3 px-2 py-2 text-left"
                      onClick={() => openArticleFromSearch(article)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: article.sourceColor }}
                          />
                          <span className="truncate text-muted-foreground">
                            {article.sourceName}
                          </span>
                        </span>
                        <span
                          className="mt-1 block text-sm font-medium text-foreground"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {article.title}
                        </span>
                        {article.excerpt ? (
                          <span
                            className="mt-1 block text-xs text-muted-foreground"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 1,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {article.excerpt}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(article.publishedAt)}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            ) : activeScreen === "feeds" ? (
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={returnToHomeScreen}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <ChevronLeft className="size-4" />
                    Back
                  </span>
                  <span className="text-xs text-muted-foreground">Commands</span>
                </Button>

                <Separator className="my-2" />

                <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Feed Actions
                </p>

                <Button
                  variant="ghost"
                  className="h-auto w-full items-center justify-between px-2 py-2"
                  onClick={handleAddFeed}
                  disabled={!canAddFeed || isAddingFeed}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {isAddingFeed ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    {feedsQuery.trim()
                      ? `Add feed source from \"${feedsQuery.trim()}\"`
                      : "Add feed source"}
                  </span>
                  <span className="text-xs text-muted-foreground">Paste RSS/YouTube URL</span>
                </Button>

                <Separator className="my-3" />

                <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Feed Sources
                </p>

                {filteredSources.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    No feed sources match this query.
                  </p>
                ) : (
                  filteredSources.map((source) => {
                    const isCustom = customFeedIds.has(source.id);
                    const isYouTube = source.isYouTube || isYouTubeFeedUrl(source.feedUrl);

                    return (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 rounded-sm px-2 py-2"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: source.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{source.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {source.feedUrl}
                          </p>
                          {isCustom && isYouTube ? (
                            <div className="mt-1 flex gap-1">
                              <Button
                                variant={source.includeShorts === false ? "outline" : "secondary"}
                                size="sm"
                                onClick={() =>
                                  updateFeedPreferences(source.id, {
                                    includeShorts: source.includeShorts === false,
                                  })
                                }
                              >
                                Shorts
                              </Button>
                              <Button
                                variant={source.includeLive === false ? "outline" : "secondary"}
                                size="sm"
                                onClick={() =>
                                  updateFeedPreferences(source.id, {
                                    includeLive: source.includeLive === false,
                                  })
                                }
                              >
                                Live
                              </Button>
                            </div>
                          ) : null}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            window.open(source.website, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <ExternalLink className="size-3" />
                          <span className="sr-only">Open source website</span>
                        </Button>

                        <Button
                          variant="destructive"
                          size="icon-xs"
                          onClick={() => removeFeed(source.id)}
                        >
                          <Trash2 className="size-3" />
                          <span className="sr-only">Remove feed</span>
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Commands
                  </p>

                  <Button
                    variant="ghost"
                    className="h-auto w-full items-center justify-between px-2 py-2"
                    onClick={() => {
                      const seedQuery = homeQuery.trim();
                      openSearchFeedsScreen(seedQuery || undefined);
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Search className="size-4" />
                      Search feeds
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      Find articles across your feed
                      <ChevronRight className="size-3.5" />
                    </span>
                  </Button>

                  <Button
                    variant="ghost"
                    className="h-auto w-full items-center justify-between px-2 py-2"
                    onClick={openThemeScreen}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Palette className="size-4" />
                      Change theme
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      Switch color theme
                      <ChevronRight className="size-3.5" />
                    </span>
                  </Button>

                  <Button
                    variant="ghost"
                    className="h-auto w-full items-center justify-between px-2 py-2"
                    onClick={openFeedsScreen}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Rss className="size-4" />
                      Manage feeds
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      Add, remove, and tune feed sources
                      <ChevronRight className="size-3.5" />
                    </span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
