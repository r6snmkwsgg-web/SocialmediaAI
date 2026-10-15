import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import "./globals.css";

// the same Anton the videos are drawn in
const anton = localFont({ src: "../public/fonts/Anton-Regular.woff2", variable: "--font-anton", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Hookline: content that makes itself, lives that pay", template: "%s · Hookline" },
  description: "Shorts made and posted for you, games your TikTok LIVE chat plays with gifts, what's rising on Shorts, and what you earned, in one place.",
  openGraph: { type: "website", siteName: "Hookline", images: ["/og/home.png"] },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#0b0b0c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${bricolage.variable} ${martian.variable}`}>
      <body className="grain font-sans">{children}</body>
    </html>
  );
}
