import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

// Show notifications (with sound) even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/** Create channels (Android) and register this phone's FCM token with the server. Returns a message for the UI. */
export async function registerForPush(): Promise<string> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Posts & comments',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#7c6cff',
      showBadge: true,
    });
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#d4a420',
      bypassDnd: false,
      showBadge: true,
    });
  }
  if (!Device.isDevice) return 'Push needs a real device';
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'Notifications are turned off for Timeline in Android settings';
  try {
    // Native FCM token: the server sends straight to Firebase, no Expo push service involved.
    const { data } = await Notifications.getDevicePushTokenAsync();
    await api.post('/push/devices', { platform: 'fcm', token: String(data), label: `${Device.manufacturer ?? ''} ${Device.modelName ?? ''}`.trim() });
    return 'Push notifications are on';
  } catch (e) {
    return `Push isn't set up in this build (${(e as Error).message.slice(0, 80)}). Add google-services.json and rebuild.`;
  }
}
