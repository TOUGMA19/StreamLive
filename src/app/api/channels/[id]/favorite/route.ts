import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
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

    const [updated] = await db
      .update(channels)
      .set({ isFavorite: !channel.isFavorite })
      .where(eq(channels.id, channelId))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error toggling favorite:", error);
    return NextResponse.json({ error: "Failed to toggle favorite" }, { status: 500 });
  }
}
