import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clawchat.app',
  appName: 'ClawChat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_clawchat',
      iconColor: '#6366f1',
    },
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#0f0f0f',
    plugins: {
      StatusBar: { overlaysWebView: true },
      Keyboard: { resize: 'native', resizeOnFullScreen: true },
    },
  },
};

export default config;
