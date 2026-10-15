import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import "./globals.css";

// the same Anton the videos are drawn in
const anton = localFont({ src: "../public/fonts/Anton-Regular.woff2", variable: "--font-anton", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Hookline: you swipe, it posts",
  description: "Hookline finds what's blowing up on Shorts, makes the video, and posts it at the best time. You just swipe yes or no.",
};

export const viewport: Viewport = { themeColor: "#0b0b0c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${bricolage.variable} ${martian.variable}`}>
      <body className="grain font-sans">{children}</body>
    </html>
  );
}
