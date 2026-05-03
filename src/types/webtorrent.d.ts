declare module "webtorrent/dist/webtorrent.min.js" {
  export type TorrentFile = {
    name: string;
    length: number;
    path?: string;
    select: () => void;
    deselect: () => void;
    renderTo: (
      element: HTMLMediaElement,
      opts: { autoplay?: boolean; controls?: boolean },
      cb: (err: Error | null) => void,
    ) => void;
    getBuffer: (cb: (err: Error | null, buffer: Uint8Array) => void) => void;
  };

  export type Torrent = {
    files: TorrentFile[];
    infoHash: string;
    ready: boolean;
    progress: number;
    downloaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    numPeers: number;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  };

  export type WebTorrentClient = {
    add: (magnet: string, opts?: { announce?: string[] }) => Torrent;
    destroy: () => void;
  };

  const WebTorrent: new (opts?: unknown) => WebTorrentClient;
  export default WebTorrent;
}
