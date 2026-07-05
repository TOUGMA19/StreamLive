import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { eq, and, ilike } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const playlistId = parseInt(id, 10);
    if (isNaN(playlistId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const group = searchParams.get("group");
    const search = searchParams.get("search");
    const favoritesOnly = searchParams.get("favorites") === "true";

    const conditions = [eq(channels.playlistId, playlistId)];

    if (group && group !== "all") {
      conditions.push(eq(channels.group, group));
    }

    if (search) {
      conditions.push(ilike(channels.name, `%${search}%`));
    }

    if (favoritesOnly) {
      conditions.push(eq(channels.isFavorite, true));
    }

    const result = await db
      .select()
      .from(channels)
      .where(and(...conditions))
      .orderBy(channels.name);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching channels:", error);
    return NextResponse.json({ error: "Failed to fetch channels" }, { status: 500 });
  }
}
