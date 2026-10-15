import type { MetadataRoute } from "next";

/** Hookline on a phone's home screen: opens straight into the app, in its own window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hookline",
    short_name: "Hookline",
    description: "Shorts made and posted for you, games for your TikTok LIVE, what's rising, and what you earned.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
