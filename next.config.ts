import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimisations pour le streaming
  experimental: {
    // Activer les optimisations de chargement
    optimizePackageImports: ["hls.js"],
  },

  // Headers personnalisés pour toutes les routes
  async headers() {
    return [
      {
        source: "/api/proxy/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS, HEAD" },
          { key: "Access-Control-Allow-Headers", value: "*" },
          { key: "Access-Control-Expose-Headers", value: "Content-Length, Content-Range" },
          { key: "Access-Control-Max-Age", value: "86400" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },

  // Rewrites pour masquer les routes API
  async rewrites() {
    return [
      {
        source: "/stream/:path*",
        destination: "/api/proxy/:path*",
      },
    ];
  },

  // Images — autoriser tous les domaines via proxy
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    unoptimized: true, // Pour le proxy image
  },
  // output: "standalone",   // ← SUPPRIMÉ pour Vercel (cause fréquente d'échec de build)
};

export default nextConfig;
