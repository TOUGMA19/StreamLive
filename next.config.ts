import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["hls.js"],
  },

  async headers() { ... },   // gardez vos headers CORS
  async rewrites() { ... },  // gardez vos rewrites

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    unoptimized: true,
  },
  // output: "standalone",   ← Supprimez cette ligne pour Vercel
};

export default nextConfig;
