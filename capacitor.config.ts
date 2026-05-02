import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'me.undersurface.app',
  appName: 'UnderSurface',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#FAF8F5',
      androidScaleType: 'CENTER_CROP',
    },
  },
}

export default config
