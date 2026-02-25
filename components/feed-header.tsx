import { Rss } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { FeedSettings } from "@/components/feed-settings";

export function FeedHeader() {
  return (
    <header className="bg-background sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
        <Rss className="size-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Dev Feed
          </h1>
          <p className="text-xs text-muted-foreground">
            Latest from engineering blogs
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <FeedSettings />
          <ThemeToggle />
        </div>
      </div>
      <Separator />
    </header>
  );
}
