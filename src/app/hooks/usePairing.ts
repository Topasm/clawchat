import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import type {
  PairingSession,
  PairingClaimRequest,
  PairingClaimResponse,
  PairedDevice,
} from '../types/connection';

/** Create a new pairing session (desktop side) */
export function useCreatePairingSession() {
  return useMutation({
    mutationFn: async (): Promise<PairingSession> => {
      const res = await apiClient.post('/pairing/session');
      return {
        code: res.data.code,
        expiresAt: res.data.expires_at,
        qrPayload: res.data.qr_payload,
      };
    },
  });
}

/** Claim a pairing session (mobile side) */
export function useClaimPairing() {
  return useMutation({
    mutationFn: async (req: PairingClaimRequest): Promise<PairingClaimResponse> => {
      const res = await apiClient.post('/pairing/claim', {
        code: req.code,
        device_name: req.deviceName,
        device_type: req.deviceType,
      });
      return {
        deviceId: res.data.device_id,
        deviceToken: res.data.device_token,
        hostName: res.data.host_name,
        serverVersion: res.data.server_version,
      };
    },
  });
}

/** List paired devices (desktop management) */
export function usePairedDevices() {
  return useQuery({
    queryKey: ['pairedDevices'],
    queryFn: async (): Promise<PairedDevice[]> => {
      const res = await apiClient.get('/pairing/devices');
      return res.data.devices.map((d: any) => ({
        id: d.id,
        name: d.name,
        deviceType: d.device_type,
        pairedAt: d.paired_at,
        lastSeen: d.last_seen,
        isActive: d.is_active,
      }));
    },
  });
}

/** Revoke a paired device */
export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) => {
      await apiClient.delete(`/pairing/devices/${deviceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pairedDevices'] });
    },
  });
}
