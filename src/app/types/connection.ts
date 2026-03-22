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

