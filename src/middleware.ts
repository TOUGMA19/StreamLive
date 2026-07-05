import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  STREAMVAULT — MIDDLEWARE ANTI-DÉTECTION                                    ║
 * ║  Sécurise les headers, masque la stack technique, ajoute CSP permissif       ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // ─── Security Headers ───────────────────────────────────────────────────────

  // Masquer la stack technique
  response.headers.delete("X-Powered-By");
  response.headers.set("Server", "nginx/1.24.0");

  // CSP permissif pour streaming cross-origin
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: *; " +
    "media-src 'self' blob: *; " +
    "connect-src 'self' *; " +
    "font-src 'self' data:; " +
    // hls.js (enableWorker: true) charge son thread de décodage via un blob: URL —
    // sans cette directive, la CSP bloquerait ce Worker et casserait la lecture HLS.
    "worker-src 'self' blob:; " +
    "frame-ancestors 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );

  // Permettre le chargement cross-origin des médias
  response.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  // Cache control pour les ressources statiques
  if (request.nextUrl.pathname.startsWith("/_next/static")) {
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  // Headers anti-fingerprinting
  response.headers.set("Permissions-Policy", 
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
  );
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-DNS-Prefetch-Control", "off");

  // Feature-Policy legacy
  response.headers.set("Feature-Policy", 
    "accelerometer 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; magnetometer 'none'; microphone 'none'; payment 'none'; usb 'none'"
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!api/proxy|_next/static|_next/image|favicon.ico).*)",
  ],
};
