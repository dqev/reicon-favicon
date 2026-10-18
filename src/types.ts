export interface Candidate {
  source: string;
  bytes: Uint8Array;
  contentType: string;
  url: string;
}

export interface Info {
  format: string;
  width: number;
  height: number;
}

export interface Resolved {
  bytes: Uint8Array;
  contentType: string;
  source: string;
  info: Info;
  url?: string;
  fallback?: boolean;
}
