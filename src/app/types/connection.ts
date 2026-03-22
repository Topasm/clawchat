// --- Connection State ---
export type ConnectionStatus =
  | 'offline'              // no network
  | 'relay_connecting'     // connecting via relay
  | 'host_unreachable'     // relay ok but host is down
  | 'host_online'          // connected to host
  | 'claude_unavailable';  // host online but Claude Code not available

// --- Claude Code Status ---
export type ClaudeCodeStatus =
  | 'available'
  | 'not_installed'
  | 'not_authenticated'
  | 'busy'
  | 'error'
  | 'unknown';

export interface ClaudeCodeInfo {
  status: ClaudeCodeStatus;
  version: string | null;
  message?: string;
}

// --- Device Pairing ---
export interface PairingSession {
  code: string;
  expiresAt: string;
  qrPayload: string;  // JSON string for QR code generation
}

export interface PairingClaimRequest {
  code: string;
  deviceName: string;
  deviceType: 'ios' | 'android';
}

export interface PairingClaimResponse {
  deviceId: string;
  deviceToken: string;
  hostName: string;
  serverVersion: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  deviceType: string;
  pairedAt: string;
  lastSeen: string;
  isActive: boolean;
}

// --- Host Info (from health endpoint) ---
export interface HostHealth {
  status: 'ok' | 'degraded';
  version: string;
  aiProvider: string;
  aiModel: string;
  aiConnected: boolean;
  claudeCodeStatus: ClaudeCodeStatus;
  claudeCodeVersion: string | null;
}

// --- Server Status (Electron IPC) ---
export interface ServerStatus {
  running: boolean;
  port: number;
  pid?: number;
  error?: string;
}
