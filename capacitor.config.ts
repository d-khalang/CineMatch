import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cinematch.app',
  appName: 'CineMatch AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'disable',
      style: 'DARK',
      hidden: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#121c17',
    },
  },
};

export default config;
