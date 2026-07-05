export interface Playlist {
  id: number;
  name: string;
  url: string | null;
  type: string;
  xtreamHost: string | null;
  xtreamUsername: string | null;
  xtreamPassword: string | null;
  channelCount: number;
  createdAt: string;
  updatedAt: string;
  groups?: GroupInfo[];
  isDefault?: boolean;
}

export interface GroupInfo {
  group: string;
  count: number;
}

export interface Channel {
  id: number;
  playlistId: number;
  name: string;
  url: string;
  logo: string | null;
  group: string;
  tvgId: string | null;
  tvgName: string | null;
  isFavorite: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}
