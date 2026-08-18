export interface SlabProfile {
  id: string;
  displayName: string;
}

export interface SlabHelloResult {
  protocolVersion: 1;
  browserVersion: string;
  browserPid: number;
  profiles: SlabProfile[];
}

export interface SlabAttachment {
  connectionId: string;
  profile: SlabProfile;
  cdpUrl: string;
  bearerToken: string;
  expiresAt: string;
}
