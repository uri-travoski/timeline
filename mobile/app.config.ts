import fs from 'node:fs';
import type { ExpoConfig } from 'expo/config';

// Drop google-services.json (from your Firebase project) next to this file to enable push notifications.
const hasFirebase = fs.existsSync('./google-services.json');

const config: ExpoConfig = {
  name: 'Timeline',
  slug: 'timeline',
  scheme: 'timeline',
  version: '1.3.4',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0b0d12',
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#000000' },
  android: {
    package: 'app.timeline.mobile',
    versionCode: 134,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundImage: './assets/adaptive-bg.png', monochromeImage: './assets/adaptive-icon.png' },
    permissions: ['POST_NOTIFICATIONS', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'CAMERA', 'REQUEST_INSTALL_PACKAGES'],
    ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
  },
  ios: {
    bundleIdentifier: 'app.timeline.mobile',
    supportsTablet: true,
    infoPlist: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
  },
  plugins: [
    'expo-router',
    ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#7c6cff', defaultChannel: 'default' }],
    ['expo-image-picker', { photosPermission: 'Timeline needs access to your photos and videos to attach them to posts.', cameraPermission: 'Timeline uses the camera to take photos for posts.' }],
    // Self-hosted servers on a LAN are often plain http://
    ['expo-build-properties', { android: { usesCleartextTraffic: true, buildArchs: ['arm64-v8a'] } }],
    'expo-secure-store',
    'expo-web-browser',
  ],
  experiments: { typedRoutes: false },
};

export default config;
