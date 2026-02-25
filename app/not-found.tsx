import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyTitle>404 - Page not found</EmptyTitle>
          <EmptyDescription>
            The page you are looking for does not exist.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/">Go back home</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
