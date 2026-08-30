import { useEffect } from 'react';
import { startActiveRemoteSessionPersistence } from '../../services/activeRemoteSession';

export default function RemoteSessionPersistence() {
  useEffect(() => startActiveRemoteSessionPersistence(), []);
  return null;
}
