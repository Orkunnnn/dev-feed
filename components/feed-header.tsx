"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { FeedSettings } from "@/components/feed-settings";
import { Button } from "@/components/ui/button";
import { useArticleHeaderContext } from "@/components/article-header-context";
import { cn } from "@/lib/utils";

export function FeedHeader() {
  const [isCompact, setIsCompact] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const { isArticleActive, articleLink, onBack } = useArticleHeaderContext();

  const showArticleHeaderControls =
    isArticleActive && isCompact && Boolean(articleLink) && Boolean(onBack);

  useEffect(() => {
    const syncCompactState = () => {
      const header = headerRef.current;
      if (!header) {
        return;
      }

      if (isArticleActive) {
        const backButton = document.querySelector<HTMLElement>(
          "[data-header-back-to-feed]"
        );

        if (!backButton) {
          setIsCompact(false);
          return;
        }

        const backButtonBottom = backButton.getBoundingClientRect().bottom;
        const next = backButtonBottom <= 0;

        setIsCompact((prev) => (prev === next ? prev : next));
        return;
      }

      const trigger = document.querySelector<HTMLElement>(
        "[data-header-compact-trigger]"
      );

      if (!trigger) {
        setIsCompact(false);
        return;
      }

      const headerBottom = header.getBoundingClientRect().bottom;
      const triggerBottom = trigger.getBoundingClientRect().bottom;

      setIsCompact((prev) => {
        const distance = triggerBottom - headerBottom;
        const next = prev ? distance <= 24 : distance <= 0;
        return prev === next ? prev : next;
      });
    };

    syncCompactState();
    window.addEventListener("scroll", syncCompactState, { passive: true });
    window.addEventListener("resize", syncCompactState);

    const observer = new MutationObserver(() => {
      syncCompactState();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener("scroll", syncCompactState);
      window.removeEventListener("resize", syncCompactState);
      observer.disconnect();
    };
  }, [isArticleActive]);

  return (
    <header ref={headerRef} className="sticky top-0 z-20">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div
          className={cn(
            "relative mx-auto w-full overflow-hidden border transform-gpu transition-[max-width,padding,border-radius,background-color,box-shadow,backdrop-filter,transform] duration-300 ease-out motion-reduce:transition-none",
            isCompact
              ? "max-w-5xl translate-y-1 rounded-none border-border/65 bg-background/42 px-4 py-3 backdrop-blur-md"
              : "max-w-full translate-y-0 rounded-none border-transparent bg-background px-4 py-3"
          )}
        >
          {isCompact ? (
            <>
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/12 via-white/4 to-transparent dark:from-white/10 dark:via-white/3" />
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(130%_80%_at_0%_-20%,rgba(255,255,255,0.20),transparent_55%)] dark:bg-[radial-gradient(130%_80%_at_0%_-20%,rgba(255,255,255,0.12),transparent_55%)]" />
            </>
          ) : null}
          <div className="relative">
            <div
              className={cn(
                "relative flex items-center gap-3 transition-[opacity,transform] duration-300 ease-out",
                showArticleHeaderControls
                  ? "pointer-events-none translate-y-1 opacity-0"
                  : "translate-y-0 opacity-100"
              )}
            >
              <AppIcon className="size-5 text-primary transition-all duration-300" />
              <div>
                <h1 className="text-lg font-semibold tracking-tight transition-all duration-300">
                  Dev Feed
                </h1>
                {!isCompact ? (
                  <p className="text-xs text-muted-foreground">
                    Engineering feed
                  </p>
                ) : null}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <FeedSettings />
                <ThemeToggle />
              </div>
            </div>

            <div
              className={cn(
                "absolute inset-0 flex items-center transition-[opacity,transform] duration-300 ease-out",
                showArticleHeaderControls
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0"
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 cursor-pointer p-0 sm:h-9 sm:w-auto sm:px-3"
                onClick={() => onBack?.()}
              >
                <ArrowLeft className="size-4" />
                <span className="sr-only sm:not-sr-only sm:ml-1">Back</span>
              </Button>

              <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
                <AppIcon className="size-5 text-primary" />
                <span className="hidden text-base font-semibold tracking-tight sm:inline">
                  Dev Feed
                </span>
              </div>

              <div className="ml-auto">
                {articleLink ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                    asChild
                  >
                    <a href={articleLink} target="_blank" rel="noopener noreferrer">
                      <ArrowUpRight className="size-3" />
                      <span className="sr-only sm:not-sr-only sm:ml-1">
                        Open original
                      </span>
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
