// --- Device Pairing ---
export interface PairingSession {
  code: string;
  expiresAt: string;
  qrPayload: string; // JSON string for QR code generation
  hostId: string;
  hostPublicKey: string;
  relayUrl: string | null;
}
