import NetInfo from '@react-native-community/netinfo';
import type { NetInfoSource } from './netinfo';

export const netInfoSource = (): NetInfoSource => ({
  getConnected: async () => (await NetInfo.fetch()).isConnected === true,
});
