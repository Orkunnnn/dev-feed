export interface Article {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  sourceColor: string;
  sourceFeedUrl?: string;
  readingTimeLabel?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  link: string;
  publishedAt: string;
  excerpt: string;
  categories: string[];
}

export interface FeedFetchResult {
  sourceId: string;
  articles: Article[];
  error?: string;
}

export interface CustomFeedSource {
  id: string;
  name: string;
  feedUrl: string;
  website: string;
  color: string;
  isCustom: true;
}

export interface ValidateFeedResponse {
  success: boolean;
  feed?: {
    name: string;
    website: string;
    feedUrl: string;
    articles: Article[];
  };
  error?: string;
}
