import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the renderer and bundler only ever run in the render worker, never in a page
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler"],
  // YouTube's thumbnails, for Trends
  images: { remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }] },
};

export default nextConfig;
