import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { FeedProvider } from "@/components/feed-provider";
import "./globals.css";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetBrainsMonoNerd = localFont({
  variable: "--font-jetbrains-mono-nerd",
  display: "swap",
  src: [
    {
      path: "../public/fonts/JetBrainsMonoNerdFont-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/JetBrainsMonoNerdFont-Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../public/fonts/JetBrainsMonoNerdFont-Bold.ttf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/JetBrainsMonoNerdFont-BoldItalic.ttf",
      weight: "700",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "Dev Feed",
  description: "Engineering blog RSS aggregator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${jetBrainsMonoNerd.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <FeedProvider>
            {children}
          </FeedProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
