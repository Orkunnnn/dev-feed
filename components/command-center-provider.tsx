"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Article } from "@/types/feed";

interface CommandCenterContextValue {
  isOpen: boolean;
  openCommandCenter: () => void;
  closeCommandCenter: () => void;
  toggleCommandCenter: () => void;
  feedSearchQuery: string;
  setFeedSearchQuery: (query: string) => void;
  searchableArticles: Article[];
  setSearchableArticles: (articles: Article[]) => void;
}

const CommandCenterContext = createContext<CommandCenterContextValue | null>(null);

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedSearchQuery, setFeedSearchQuery] = useState("");
  const [searchableArticles, setSearchableArticles] = useState<Article[]>([]);

  const openCommandCenter = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeCommandCenter = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleCommandCenter = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") {
        return;
      }

      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      if (event.altKey) {
        return;
      }

      if (event.shiftKey && isEditableElement(event.target)) {
        return;
      }

      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      openCommandCenter,
      closeCommandCenter,
      toggleCommandCenter,
      feedSearchQuery,
      setFeedSearchQuery,
      searchableArticles,
      setSearchableArticles,
    }),
    [
      closeCommandCenter,
      feedSearchQuery,
      isOpen,
      openCommandCenter,
      searchableArticles,
      toggleCommandCenter,
    ]
  );

  return (
    <CommandCenterContext.Provider value={value}>
      {children}
    </CommandCenterContext.Provider>
  );
}

export function useCommandCenter(): CommandCenterContextValue {
  const context = useContext(CommandCenterContext);
  if (!context) {
    throw new Error("useCommandCenter must be used within CommandCenterProvider");
  }

  return context;
}
