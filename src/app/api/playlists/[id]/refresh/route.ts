import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, channels } from "@/db/schema";
import { parseM3U } from "@/lib/m3u-parser";
import { eq } from "drizzle-orm";

export async function POST(
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
      return NextResponse.json({ error: "Playlist introuvable" }, { status: 404 });
    }

    let fetchUrl = playlist.url;

    // Rebuild Xtream URL if needed
    if (playlist.type === "xtream" && playlist.xtreamHost && playlist.xtreamUsername && playlist.xtreamPassword) {
      const host = playlist.xtreamHost.replace(/\/+$/, "");
      fetchUrl = `${host}/get.php?username=${encodeURIComponent(playlist.xtreamUsername)}&password=${encodeURIComponent(playlist.xtreamPassword)}&type=m3u_plus&output=ts`;
    }

    if (!fetchUrl) {
      return NextResponse.json({ error: "Cette playlist n'a pas d'URL de source" }, { status: 400 });
    }

    const response = await fetch(fetchUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      return NextResponse.json({ error: "Impossible de télécharger la playlist" }, { status: 400 });
    }

    const content = await response.text();
    const parsedChannels = parseM3U(content);

    if (parsedChannels.length === 0) {
      return NextResponse.json({ error: "Aucune chaîne trouvée" }, { status: 400 });
    }

    // Get existing favorites
    const existingChannels = await db.select({ name: channels.name, isFavorite: channels.isFavorite })
      .from(channels)
      .where(eq(channels.playlistId, playlistId));

    const favoriteNames = new Set(
      existingChannels.filter((c) => c.isFavorite).map((c) => c.name)
    );

    // Delete old channels and re-insert
    await db.delete(channels).where(eq(channels.playlistId, playlistId));

    const batchSize = 100;
    for (let i = 0; i < parsedChannels.length; i += batchSize) {
      const batch = parsedChannels.slice(i, i + batchSize);
      await db.insert(channels).values(
        batch.map((ch) => ({
          playlistId,
          name: ch.name,
          url: ch.url,
          logo: ch.logo,
          group: ch.group || "Sans catégorie",
          tvgId: ch.tvgId,
          tvgName: ch.tvgName,
          isFavorite: favoriteNames.has(ch.name),
        }))
      );
    }

    await db.update(playlists).set({
      channelCount: parsedChannels.length,
      updatedAt: new Date(),
    }).where(eq(playlists.id, playlistId));

    return NextResponse.json({
      success: true,
      channelCount: parsedChannels.length,
    });
  } catch (error) {
    console.error("Error refreshing playlist:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
