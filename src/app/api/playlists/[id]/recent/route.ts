import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, recentlyWatched } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const playlistId = parseInt(id, 10);
    if (isNaN(playlistId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    // Get 20 most recent unique channels
    const recent = await db
      .selectDistinctOn([recentlyWatched.channelId], {
        id: channels.id,
        playlistId: channels.playlistId,
        name: channels.name,
        url: channels.url,
        logo: channels.logo,
        group: channels.group,
        tvgId: channels.tvgId,
        tvgName: channels.tvgName,
        isFavorite: channels.isFavorite,
        createdAt: channels.createdAt,
        watchedAt: recentlyWatched.watchedAt,
      })
      .from(recentlyWatched)
      .innerJoin(channels, eq(recentlyWatched.channelId, channels.id))
      .where(and(eq(channels.playlistId, playlistId)))
      .orderBy(recentlyWatched.channelId, desc(recentlyWatched.watchedAt))
      .limit(20);

    // Re-sort by watchedAt desc
    recent.sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime());

    return NextResponse.json(recent);
  } catch (error) {
    console.error("Error fetching recent:", error);
    return NextResponse.json({ error: "Failed to fetch recent channels" }, { status: 500 });
  }
}
