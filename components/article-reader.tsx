"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { Article } from "@/types/feed";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import {
  decodeHtmlEntities,
  extractReadTimeLabelFromContent,
  estimateReadingMinutes,
  formatDate,
  formatReadingTime,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ArrowLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { type FetchArticleResult } from "@/lib/actions/fetch-article-content";
import {
  getCachedArticleContent,
  loadArticleContent,
} from "@/lib/article-content-client-cache";
import { ArticleContent } from "./article-content";

interface Props {
  article: Article;
  onBack: () => void;
  layout?: "page" | "pane";
}

interface SubtitleAuthor {
  name: string;
  profileUrl: string;
  avatarUrl?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSubtitleText(value: string): string {
  return normalizeText(
    decodeHtmlEntities(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00a0/g, " ")
  );
}

export function ArticleReader({ article, onBack, layout = "page" }: Props) {
  const isPaneLayout = layout === "pane";
  const [resolvedContent, setResolvedContent] = useState<{
    link: string;
    result: FetchArticleResult;
  } | null>(() => {
    const cached = getCachedArticleContent(article.link, article.sourceFeedUrl);
    return cached ? { link: article.link, result: cached } : null;
  });

  const isLoading = !resolvedContent || resolvedContent.link !== article.link;
  const content = isLoading ? null : resolvedContent.result;

  const readTimeLabel = useMemo(() => {
    if (article.readingTimeLabel) {
      return article.readingTimeLabel;
    }

    if (content && !("error" in content)) {
      if (content.readingTimeLabel) {
        return content.readingTimeLabel;
      }

      const extractedReadTime = extractReadTimeLabelFromContent(content.content)
      if (extractedReadTime) {
        return extractedReadTime
      }

      return formatReadingTime(estimateReadingMinutes(content.content));
    }

    return undefined;
  }, [article.readingTimeLabel, content]);

  const subtitle = useMemo(() => {
    const candidate = article.excerpt || null;

    if (!candidate) return null;

    const normalizedCandidate = normalizeSubtitleText(candidate);
    const normalizedTitle = normalizeSubtitleText(article.title);

    if (!normalizedCandidate) return null;
    if (normalizedCandidate.toLowerCase() === normalizedTitle.toLowerCase()) {
      return null;
    }

    return normalizedCandidate;
  }, [article.excerpt, article.title]);

  const subtitleAuthors = useMemo(() => {
    if (!content || "error" in content || !content.authors?.length) {
      return [];
    }

    const uniqueAuthors = new Map<string, SubtitleAuthor>();

    for (const author of content.authors) {
      const name = normalizeSubtitleText(author.name).replace(
        /^[,;:\s]+|[,;:\s]+$/g,
        ""
      );
      const profileUrl = author.profileUrl.trim();
      const avatarUrl =
        "avatarUrl" in author && typeof author.avatarUrl === "string"
          ? author.avatarUrl.trim()
          : undefined;
      if (!name || !profileUrl) {
        continue;
      }

      if (!uniqueAuthors.has(profileUrl)) {
        uniqueAuthors.set(profileUrl, { name, profileUrl, avatarUrl });
        continue;
      }

      if (avatarUrl) {
        const existing = uniqueAuthors.get(profileUrl);
        if (existing && !existing.avatarUrl) {
          uniqueAuthors.set(profileUrl, { ...existing, avatarUrl });
        }
      }
    }

    return [...uniqueAuthors.values()];
  }, [content]);

  const authorName = useMemo(() => {
    if (content && !("error" in content) && content.authorName) {
      return content.authorName;
    }

    return article.authorName;
  }, [article.authorName, content]);

  const authorAvatarUrl = useMemo(() => {
    if (content && !("error" in content) && content.authorAvatarUrl) {
      return content.authorAvatarUrl;
    }

    return article.authorAvatarUrl;
  }, [article.authorAvatarUrl, content]);

  const showMetadataAuthor =
    !isLoading && (subtitleAuthors.length > 0 || authorName || authorAvatarUrl);

  const shouldUseAuthorComma = useMemo(
    () => !subtitleAuthors.some((author) => Boolean(author.avatarUrl)),
    [subtitleAuthors]
  );

  const visibleSubtitleAuthors = useMemo(
    () => subtitleAuthors.slice(0, 2),
    [subtitleAuthors]
  );

  const hiddenSubtitleAuthors = useMemo(
    () => subtitleAuthors.slice(2),
    [subtitleAuthors]
  );

  const isSummaryOnly = Boolean(
    content && !("error" in content) && content.contentMode === "summary"
  );

  useEffect(() => {
    let stale = false;

    loadArticleContent(article.link, article.sourceFeedUrl).then((result) => {
      if (!stale) {
        setResolvedContent({ link: article.link, result });
      }
    });

    return () => {
      stale = true;
    };
  }, [article.link, article.sourceFeedUrl]);

  useEffect(() => {
    if (!content || "error" in content || !content.content.trim()) {
      return;
    }

    if (!/<img[\s>]/i.test(content.content)) {
      return;
    }

    if (typeof DOMParser === "undefined" || typeof Image === "undefined") {
      return;
    }

    const parser = new DOMParser();
    const document = parser.parseFromString(content.content, "text/html");
    const preloadTargets = Array.from(document.querySelectorAll("img"));
    const preloaders: HTMLImageElement[] = [];

    for (const imageElement of preloadTargets) {
      const src = imageElement.getAttribute("src")?.trim();
      const fallbackSrc =
        imageElement.getAttribute("data-src")?.trim() ||
        imageElement.getAttribute("data-lazy-src")?.trim() ||
        imageElement.getAttribute("data-original")?.trim();
      const resolvedSrc =
        src && !src.startsWith("data:image/") ? src : fallbackSrc || src;

      const srcSet =
        imageElement.getAttribute("srcset")?.trim() ||
        imageElement.getAttribute("data-srcset")?.trim() ||
        imageElement.getAttribute("data-lazy-srcset")?.trim();
      const sizes = imageElement.getAttribute("sizes")?.trim() || "100vw";

      if (!resolvedSrc && !srcSet) {
        continue;
      }

      const preloader = new Image();
      preloader.decoding = "async";
      preloader.fetchPriority = "high";

      if (srcSet) {
        preloader.srcset = srcSet;
        preloader.sizes = sizes;
      }

      if (resolvedSrc) {
        preloader.src = resolvedSrc;
      }

      preloaders.push(preloader);
    }

    return () => {
      for (const preloader of preloaders) {
        preloader.src = "";
        preloader.srcset = "";
      }
    };
  }, [content]);

  return (
    <div
      data-reading-progress-root
      className={
        isPaneLayout
          ? "animate-in fade-in slide-in-from-right-2 duration-300"
          : "animate-in fade-in slide-in-from-bottom-4 duration-300"
      }
    >
      {/* Reader header */}
      <div
        data-header-compact-trigger
        className={
          isPaneLayout
            ? "mb-4 grid grid-cols-[1fr_auto] items-center gap-3"
            : "mb-6 grid grid-cols-[auto_1fr_auto] items-center gap-3"
        }
      >
        {!isPaneLayout ? (
          <Button
            data-header-back-to-feed
            className="hover:cursor-pointer"
            variant="ghost"
            size="sm"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
            Back to feed
          </Button>
        ) : null}
        <div className={isPaneLayout ? "flex items-center text-sm" : "flex items-center justify-center text-sm"}>
          <p style={{ color: article.sourceColor }}>{article.sourceName}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original
            <ArrowUpRight className="size-3" />
          </a>
        </Button>
      </div>

      {/* Article header */}
      <div className="mb-2">
        <h1
          className={
            isPaneLayout
              ? "mx-auto max-w-4xl text-balance text-left text-2xl font-medium leading-tight tracking-tight md:text-3xl"
              : "mx-auto max-w-5xl text-balance text-center text-3xl font-medium leading-tight tracking-tight md:text-5xl lg:text-6xl"
          }
        >
          {article.title}
        </h1>
        {subtitle ? (
          <p
            className={
              isPaneLayout
                ? "mx-auto mt-3 max-w-4xl text-balance text-left text-base text-foreground/90 md:text-lg"
                : "mx-auto mt-4 max-w-4xl text-balance text-center text-xl text-foreground/90 md:mt-5 md:text-2xl"
            }
          >
            {subtitle}
          </p>
        ) : null}
        <div
          className={
            isPaneLayout
              ? "mx-auto mt-4 grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)] items-center text-sm text-muted-foreground"
              : "mx-auto mt-5 grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)] items-center text-sm text-muted-foreground"
          }
        >
          <time dateTime={article.publishedAt} className="truncate">
            {formatDate(article.publishedAt)}
          </time>
          <div className="flex min-w-0 items-center justify-center" style={{ gap: 8 }}>
            {showMetadataAuthor ? (
              subtitleAuthors.length > 0 ? (
                <>
                  <Sheet>
                    <SheetTrigger asChild>
                      <button
                        type="button"
                        className="truncate text-muted-foreground transition-colors hover:text-foreground sm:hidden"
                        aria-label={`Show ${subtitleAuthors.length} contributors`}
                      >
                        {subtitleAuthors.length} contributor
                        {subtitleAuthors.length === 1 ? "" : "s"}
                      </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="max-h-[70dvh]">
                      <SheetHeader>
                        <SheetTitle>Contributors</SheetTitle>
                        <SheetDescription>
                          {subtitleAuthors.length} contributor
                          {subtitleAuthors.length === 1 ? "" : "s"} for this article
                        </SheetDescription>
                      </SheetHeader>
                      <div className="overflow-y-auto px-4 pb-4">
                        <div className="space-y-1">
                          {subtitleAuthors.map((author) => (
                            <a
                              key={`sheet-author-${author.profileUrl}`}
                              href={author.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-1 py-1"
                            >
                              {author.avatarUrl ? (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 9999,
                                    display: "inline-block",
                                    backgroundImage: `url(${author.avatarUrl})`,
                                    backgroundPosition: "center",
                                    backgroundSize: "cover",
                                    backgroundRepeat: "no-repeat",
                                  }}
                                />
                              ) : (
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] uppercase text-muted-foreground">
                                  {author.name.charAt(0)}
                                </span>
                              )}
                              <span className="truncate text-sm text-foreground">
                                {author.name}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    </SheetContent>
                  </Sheet>

                  <span className="hidden min-w-0 items-center sm:inline-flex" style={{ gap: 8 }}>
                    <span
                      className="inline-flex min-w-0 items-center"
                      style={{ gap: shouldUseAuthorComma ? 2 : 8 }}
                    >
                      {visibleSubtitleAuthors.map((author, index) => (
                        <Fragment key={author.profileUrl}>
                          {shouldUseAuthorComma && index > 0 ? ",\u00a0" : null}
                          <span
                            className="inline-flex min-w-0 items-center whitespace-nowrap"
                            style={{ gap: 4 }}
                          >
                            {author.avatarUrl ? (
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 9999,
                                  display: "inline-block",
                                  backgroundImage: `url(${author.avatarUrl})`,
                                  backgroundPosition: "center",
                                  backgroundSize: "cover",
                                  backgroundRepeat: "no-repeat",
                                }}
                              />
                            ) : null}
                            <a
                              href={author.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="max-w-[12rem] truncate text-inherit transition-colors hover:text-foreground"
                            >
                              {author.name}
                            </a>
                          </span>
                        </Fragment>
                      ))}
                    </span>

                    {hiddenSubtitleAuthors.length > 0 ? (
                      <TooltipPrimitive.Provider delayDuration={120}>
                        <TooltipPrimitive.Root>
                          <TooltipPrimitive.Trigger asChild>
                            <button
                              type="button"
                              className="cursor-help appearance-none border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label={`Show all ${subtitleAuthors.length} authors`}
                            >
                              +{hiddenSubtitleAuthors.length} more
                            </button>
                          </TooltipPrimitive.Trigger>
                          <TooltipPrimitive.Portal>
                            <TooltipPrimitive.Content
                              side="bottom"
                              align="center"
                              sideOffset={8}
                              className="z-50 max-h-72 w-64 overflow-y-auto border bg-popover p-2 text-popover-foreground shadow-md"
                            >
                              <p className="px-1 pb-1 text-xs text-muted-foreground">
                                {subtitleAuthors.length} contributors
                              </p>
                              <div className="space-y-1">
                                {subtitleAuthors.map((author) => (
                                  <a
                                    key={`tooltip-author-${author.profileUrl}`}
                                    href={author.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-1 py-1"
                                  >
                                    {author.avatarUrl ? (
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: 9999,
                                          display: "inline-block",
                                          backgroundImage: `url(${author.avatarUrl})`,
                                          backgroundPosition: "center",
                                          backgroundSize: "cover",
                                          backgroundRepeat: "no-repeat",
                                        }}
                                      />
                                    ) : (
                                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] uppercase text-muted-foreground">
                                        {author.name.charAt(0)}
                                      </span>
                                    )}
                                    <span className="truncate text-xs text-foreground">
                                      {author.name}
                                    </span>
                                  </a>
                                ))}
                              </div>
                            </TooltipPrimitive.Content>
                          </TooltipPrimitive.Portal>
                        </TooltipPrimitive.Root>
                      </TooltipPrimitive.Provider>
                    ) : null}
                  </span>
                </>
              ) : (
                <span className="inline-flex min-w-0 items-center" style={{ gap: 8 }}>
                  {authorAvatarUrl && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 9999,
                        display: "inline-block",
                        backgroundImage: `url(${authorAvatarUrl})`,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                        backgroundRepeat: "no-repeat",
                      }}
                    />
                  )}
                  {authorName && <span className="max-w-[16rem] truncate">{authorName}</span>}
                </span>
              )
            ) : null}
          </div>
          <span className="truncate text-right">{readTimeLabel || ""}</span>
        </div>
      </div>

      <Separator className="mb-2" />

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading article...</span>
        </div>
      )}

      {!isLoading && content && "error" in content && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <p>{content.error}</p>
          <Button variant="link" size="sm" asChild>
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original article
              <ArrowUpRight className="size-3" />
            </a>
          </Button>
        </div>
      )}

      {!isLoading && content && !("error" in content) && isSummaryOnly && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <p>Full article content is unavailable from this source.</p>
          <Button variant="link" size="sm" asChild>
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original article
              <ArrowUpRight className="size-3" />
            </a>
          </Button>
        </div>
      )}

      {!isLoading && content && !("error" in content) && !isSummaryOnly && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <ArticleContent
            html={content.content}
            articleLink={article.link}
            sourceId={article.sourceId}
          />
        </div>
      )}
    </div>
  );
}
