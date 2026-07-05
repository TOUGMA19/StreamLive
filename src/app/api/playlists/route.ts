import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, channels } from "@/db/schema";
import { parseM3U } from "@/lib/m3u-parser";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const allPlaylists = await db.select().from(playlists).orderBy(desc(playlists.createdAt));
    return NextResponse.json(allPlaylists);
  } catch (error) {
    console.error("Error fetching playlists:", error);
    return NextResponse.json({ error: "Failed to fetch playlists" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, url, m3uContent, type, xtreamHost, xtreamUsername, xtreamPassword } = body as {
      name: string;
      url?: string;
      m3uContent?: string;
      type?: string;
      xtreamHost?: string;
      xtreamUsername?: string;
      xtreamPassword?: string;
    };

    if (!name) {
      return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
    }

    let content = m3uContent || "";

    // Xtream Codes API support
    if (type === "xtream" && xtreamHost && xtreamUsername && xtreamPassword) {
      const host = xtreamHost.replace(/\/+$/, "");
      const xtreamUrl = `${host}/get.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}&type=m3u_plus&output=ts`;
      try {
        const response = await fetch(xtreamUrl, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) {
          return NextResponse.json({ error: "Échec de connexion Xtream. Vérifiez vos identifiants." }, { status: 400 });
        }
        content = await response.text();
      } catch {
        return NextResponse.json({ error: "Impossible de se connecter au serveur Xtream" }, { status: 400 });
      }

      const parsedChannels = parseM3U(content);
      if (parsedChannels.length === 0) {
        return NextResponse.json({ error: "Aucune chaîne trouvée" }, { status: 400 });
      }

      const [playlist] = await db.insert(playlists).values({
        name,
        url: xtreamUrl,
        type: "xtream",
        xtreamHost: host,
        xtreamUsername,
        xtreamPassword,
        channelCount: parsedChannels.length,
      }).returning();

      const batchSize = 100;
      for (let i = 0; i < parsedChannels.length; i += batchSize) {
        const batch = parsedChannels.slice(i, i + batchSize);
        await db.insert(channels).values(
          batch.map((ch) => ({
            playlistId: playlist.id,
            name: ch.name,
            url: ch.url,
            logo: ch.logo,
            group: ch.group || "Sans catégorie",
            tvgId: ch.tvgId,
            tvgName: ch.tvgName,
          }))
        );
      }

      return NextResponse.json({ ...playlist, channelCount: parsedChannels.length }, { status: 201 });
    }

    // M3U URL
    if (url && !m3uContent) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) {
          return NextResponse.json({ error: "Impossible de télécharger la playlist M3U" }, { status: 400 });
        }
        content = await response.text();
      } catch {
        return NextResponse.json({ error: "Impossible de télécharger la playlist M3U" }, { status: 400 });
      }
    }

    if (!content) {
      return NextResponse.json({ error: "URL ou contenu M3U requis" }, { status: 400 });
    }

    const parsedChannels = parseM3U(content);
    if (parsedChannels.length === 0) {
      return NextResponse.json({ error: "Aucune chaîne trouvée dans le contenu M3U" }, { status: 400 });
    }

    const [playlist] = await db.insert(playlists).values({
      name,
      url: url || null,
      type: "m3u",
      channelCount: parsedChannels.length,
    }).returning();

    const batchSize = 100;
    for (let i = 0; i < parsedChannels.length; i += batchSize) {
      const batch = parsedChannels.slice(i, i + batchSize);
      await db.insert(channels).values(
        batch.map((ch) => ({
          playlistId: playlist.id,
          name: ch.name,
          url: ch.url,
          logo: ch.logo,
          group: ch.group || "Sans catégorie",
          tvgId: ch.tvgId,
          tvgName: ch.tvgName,
        }))
      );
    }

    return NextResponse.json({
      ...playlist,
      channelCount: parsedChannels.length,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating playlist:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
