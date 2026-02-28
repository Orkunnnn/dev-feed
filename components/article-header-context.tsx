"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ArticleHeaderState {
  isArticleActive: boolean;
  articleLink: string | null;
  onBack: (() => void) | null;
}

interface ArticleHeaderContextValue extends ArticleHeaderState {
  setArticleHeaderState: (state: ArticleHeaderState) => void;
  clearArticleHeaderState: () => void;
}

const INITIAL_ARTICLE_HEADER_STATE: ArticleHeaderState = {
  isArticleActive: false,
  articleLink: null,
  onBack: null,
};

const ArticleHeaderContext = createContext<ArticleHeaderContextValue | null>(null);

export function ArticleHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ArticleHeaderState>(
    INITIAL_ARTICLE_HEADER_STATE
  );

  const setArticleHeaderState = useCallback((nextState: ArticleHeaderState) => {
    setState(nextState);
  }, []);

  const clearArticleHeaderState = useCallback(() => {
    setState(INITIAL_ARTICLE_HEADER_STATE);
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      setArticleHeaderState,
      clearArticleHeaderState,
    }),
    [clearArticleHeaderState, setArticleHeaderState, state]
  );

  return (
    <ArticleHeaderContext.Provider value={value}>
      {children}
    </ArticleHeaderContext.Provider>
  );
}

export function useArticleHeaderContext() {
  const context = useContext(ArticleHeaderContext);
  if (!context) {
    throw new Error(
      "useArticleHeaderContext must be used within an ArticleHeaderProvider"
    );
  }

  return context;
}
