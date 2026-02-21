import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clawchat.app',
  appName: 'ClawChat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
