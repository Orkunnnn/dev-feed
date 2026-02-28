"use client";

import { useState } from "react";
import { Settings, Plus, Trash2, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useFeedContext } from "./feed-provider";
import { cn } from "@/lib/utils";
import { isYouTubeFeedUrl } from "@/lib/youtube";

interface Props {
  compact?: boolean;
}

export function FeedSettings({ compact = false }: Props) {
  const {
    customFeeds,
    allSources,
    addFeed,
    updateFeedPreferences,
    removeFeed,
  } = useFeedContext();
  const [feedUrl, setFeedUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customFeedIds = new Set(customFeeds.map((feed) => feed.id));
  const defaultFeeds = allSources.filter((feed) => !customFeedIds.has(feed.id));

  async function handleAddFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!feedUrl.trim()) return;

    setIsAdding(true);
    setError(null);

    try {
      const result = await addFeed(feedUrl.trim());
      if (result.success) {
        setFeedUrl("");
      } else {
        setError(result.error || "Failed to add feed");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon-xs" : "icon-sm"}
          className={cn(
            "transition-[width,height,padding,transform] duration-300 ease-out",
            compact ? "scale-95" : "scale-100"
          )}
        >
          <Settings className="size-4" />
          <span className="sr-only">Feed settings</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Feed Sources</SheetTitle>
          <SheetDescription>
            Manage your RSS feed sources.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <form onSubmit={handleAddFeed} className="space-y-2">
            <Label htmlFor="feed-url">Add Custom Feed</Label>
            <div className="flex gap-2">
              <Input
                id="feed-url"
                type="url"
                placeholder="https://example.com/feed.xml or https://youtube.com/@channel"
                value={feedUrl}
                onChange={(e) => {
                  setFeedUrl(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isAdding}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isAdding || !feedUrl.trim()}
              >
                {isAdding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>

          {customFeeds.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Custom Feeds
                </h3>
                {customFeeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center gap-2 rounded-sm px-1 py-1.5"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: feed.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {feed.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {feed.feedUrl}
                      </p>
                      {feed.isYouTube || isYouTubeFeedUrl(feed.feedUrl) ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Button
                            variant={feed.includeShorts === false ? "outline" : "secondary"}
                            size="sm"
                            onClick={() =>
                              updateFeedPreferences(feed.id, {
                                includeShorts: feed.includeShorts === false,
                              })
                            }
                          >
                            Shorts
                          </Button>
                          <Button
                            variant={feed.includeLive === false ? "outline" : "secondary"}
                            size="sm"
                            onClick={() =>
                              updateFeedPreferences(feed.id, {
                                includeLive: feed.includeLive === false,
                              })
                            }
                          >
                            Live
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="icon-xs">
                          <Trash2 className="size-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove feed?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove &ldquo;{feed.name}&rdquo; and its
                            articles from your feed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => removeFeed(feed.id)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </>
          )}

          <Separator className="my-4" />

          <div className="space-y-1">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Feeds
            </h3>
            {defaultFeeds.map((feed) => (
              <div
                key={feed.id}
                className="flex items-center gap-2 rounded-sm px-1 py-1.5"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: feed.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{feed.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {feed.feedUrl}
                  </p>
                </div>
                <a
                  href={feed.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="ghost" size="icon-xs" asChild>
                    <span>
                      <ExternalLink className="size-3" />
                    </span>
                  </Button>
                </a>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="icon-xs">
                      <Trash2 className="size-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove feed?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove &ldquo;{feed.name}&rdquo; and its
                        articles from your feed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => removeFeed(feed.id)}
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
