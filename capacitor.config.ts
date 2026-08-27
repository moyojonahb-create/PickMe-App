import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'zw.co.pickme',
  appName: 'CruiXe',
  webDir: 'dist',
  server: {
    // NOTE: Uncomment only for local development with live reload
    // Do NOT use Lovable sandbox URL in production
    // url: 'http://192.168.x.x:5173',
    // cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#B81104',
      showSpinner: false,
      androidScaleType: 'CENTER_INSIDE',
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      style: 'light',
      backgroundColor: '#B81104'
    }
  },
  android: {
    allowMixedContent: false
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
