export interface M3UChannel {
  name: string;
  url: string;
  logo: string | null;
  group: string;
  tvgId: string | null;
  tvgName: string | null;
}

export function parseM3U(content: string): M3UChannel[] {
  const channels: M3UChannel[] = [];
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let i = 0;
  // skip #EXTM3U header if present
  if (lines.length > 0 && lines[0].startsWith("#EXTM3U")) {
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("#EXTINF:")) {
      // Parse the EXTINF line
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);

      // Channel name is everything after the last comma
      const commaIdx = line.lastIndexOf(",");
      const name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : "Unknown";

      // Next non-comment line should be the URL
      i++;
      while (i < lines.length && lines[i].startsWith("#")) {
        i++;
      }

      if (i < lines.length) {
        const url = lines[i].trim();
        if (url && !url.startsWith("#")) {
          channels.push({
            name: name || "Unknown",
            url,
            logo: tvgLogoMatch?.[1] || null,
            group: groupMatch?.[1] || "Uncategorized",
            tvgId: tvgIdMatch?.[1] || null,
            tvgName: tvgNameMatch?.[1] || null,
          });
        }
      }
    }
    i++;
  }

  return channels;
}
