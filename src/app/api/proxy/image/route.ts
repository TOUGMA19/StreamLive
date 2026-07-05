import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
];

const FORWARDED_IPS = [
  "104.28.210.170", "172.67.182.45", "34.102.136.180",
  "185.93.3.65", "138.201.81.199", "163.172.30.18",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) return new NextResponse(null, { status: 400 });

  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    let origin: string;
    try { origin = new URL(decodedUrl).origin; } catch { origin = "https://www.google.com"; }

    const response = await fetch(decodedUrl, {
      headers: {
        "User-Agent": pick(USER_AGENTS),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": origin + "/",
        "X-Forwarded-For": pick(FORWARDED_IPS),
        "CF-Connecting-IP": pick(FORWARDED_IPS),
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });

    if (!response.ok) return new NextResponse(null, { status: response.status });

    const contentType = response.headers.get("content-type") || "image/png";
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
