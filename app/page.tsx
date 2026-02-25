import { fetchAllFeeds } from "@/lib/fetch-feeds";
import { Suspense } from "react";
import { FeedHeader } from "@/components/feed-header";
import { ArticleList } from "@/components/article-list";

export const revalidate = 900;

export default async function Home() {
  const articles = await fetchAllFeeds();

  return (
    <div className="min-h-screen">
      <FeedHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Suspense fallback={null}>
          <ArticleList articles={articles} />
        </Suspense>
      </main>
    </div>
  );
}
