import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import { QueryClient, QueryClientProvider, focusManager, useQueryClient } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError, api, session } from '../src/api';
import { checkForUpdate } from '../src/updates';
import { registerForPush } from '../src/push';
import { FiltersProvider, useMe } from '../src/state';
import { ThemeProvider, useTheme } from '../src/theme';
import Login from '../src/Login';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status > 0 && e.status < 500) && n < 2, staleTime: 15_000 } },
});

// Refetch when the app comes back to the foreground.
AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));

export default function Root() {
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  useEffect(() => {
    session.load().then(({ token }) => setState(token ? 'in' : 'out'));
    session.onUnauthorized(() => {
      session.clear();
      qc.clear();
      setState('out');
    });
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        {state === 'loading' ? (
          <View style={{ flex: 1, backgroundColor: '#0b0d12', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#7c6cff" size="large" />
          </View>
        ) : state === 'out' ? (
          <ThemeProvider name="system">
            <Login onDone={() => setState('in')} />
          </ThemeProvider>
        ) : (
          <SignedIn />
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function SignedIn() {
  const me = useMe();
  return (
    <ThemeProvider name={me.data?.user.settings.theme ?? 'system'}>
      <FiltersProvider>
        <AppStack />
      </FiltersProvider>
    </ThemeProvider>
  );
}

function AppStack() {
  const t = useTheme();
  const client = useQueryClient();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);

  // Push: register this phone, and open the post when a notification is tapped.
  useEffect(() => {
    registerForPush().catch(() => {});
    const open = (r: Notifications.NotificationResponse | null) => {
      const d = r?.notification.request.content.data as any;
      if (!d) return;
      if (d.notificationId) api.post('/notifications/read', { ids: [d.notificationId] }).then(() => client.invalidateQueries({ queryKey: ['unread'] })).catch(() => {});
      if (d.postId) router.push(`/post/${d.postId}`);
      else router.push('/notifications');
    };
    Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    // A push arriving while the app is open should update the bell immediately.
    const sub2 = Notifications.addNotificationReceivedListener(() => {
      client.invalidateQueries({ queryKey: ['unread'] });
      client.invalidateQueries({ queryKey: ['posts'] });
    });
    return () => {
      sub.remove();
      sub2.remove();
    };
  }, [client]);

  // Once per app start: offer a newer version if the server knows one. Failures stay silent.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    checkForUpdate()
      .then((u) => {
        if (!u.updateAvailable) return;
        const mb = u.size ? ` (${(u.size / 1048576).toFixed(0)} MB)` : '';
        Alert.alert('Update available', `Timeline ${u.latest} is ready${mb}. You have ${u.current}.`, [
          { text: 'Later', style: 'cancel' },
          { text: 'Update now', onPress: () => router.push('/settings?install=1') },
        ]);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="viewer" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
    </>
  );
}
