import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, channels } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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

    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId));
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    const groups = await db
      .select({
        group: channels.group,
        count: sql<number>`count(*)::int`,
      })
      .from(channels)
      .where(eq(channels.playlistId, playlistId))
      .groupBy(channels.group)
      .orderBy(channels.group);

    const totalCount = groups.reduce((sum, g) => sum + g.count, 0);

    return NextResponse.json({ ...playlist, groups, channelCount: totalCount });
  } catch (error) {
    console.error("Error fetching playlist:", error);
    return NextResponse.json({ error: "Failed to fetch playlist" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const playlistId = parseInt(id, 10);
    if (isNaN(playlistId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    await db.delete(playlists).where(eq(playlists.id, playlistId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting playlist:", error);
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 });
  }
}
