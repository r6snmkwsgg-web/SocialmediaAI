import type { MetadataRoute } from "next";

/** The website's pages, for search engines. The app itself is private. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const pages: [string, number][] = [["", 1], ["/shorts", 0.8], ["/live", 0.8], ["/trends", 0.7], ["/privacy", 0.3], ["/terms", 0.3]];
  return pages.map(([path, priority]) => ({ url: `${base}${path}`, lastModified: new Date("2026-10-15"), changeFrequency: "weekly", priority }));
}
