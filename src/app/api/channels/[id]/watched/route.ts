import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recentlyWatched, channels } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const channelId = parseInt(id, 10);
    if (isNaN(channelId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    await db.insert(recentlyWatched).values({ channelId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error recording watch:", error);
    return NextResponse.json({ error: "Failed to record watch" }, { status: 500 });
  }
}
