import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { cacheDirectory, createDownloadResumable, deleteAsync, getContentUriAsync, getInfoAsync } from 'expo-file-system/legacy';
import { ApiError, abs, api, session } from './api';

export interface UpdateInfo {
  configured: boolean;
  current?: string;
  latest?: string;
  updateAvailable?: boolean;
  notes?: string;
  size?: number;
  downloadUrl?: string;
  error?: string;
}

export const installedVersion = () => Application.nativeApplicationVersion ?? '0.0.0';

/** Asks the Timeline server whether a newer release exists (the server looks at GitHub, so phones need no GitHub login). */
export const checkForUpdate = (refresh = false) =>
  api.get<UpdateInfo>(`/app/update?version=${encodeURIComponent(installedVersion())}${refresh ? '&refresh=1' : ''}`);

/** Downloads the new APK (with progress) and hands it to Android's installer. */
export async function downloadAndInstall(info: UpdateInfo, onProgress: (fraction: number) => void): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('In-app updates are only available on Android');
  if (!info.downloadUrl) throw new Error('No download available');
  const { token } = await session.load();
  const file = `${cacheDirectory}timeline-update.apk`;
  await deleteAsync(file, { idempotent: true });
  const dl = createDownloadResumable(abs(info.downloadUrl)!, file, { headers: { authorization: `Bearer ${token}` } }, (p) =>
    onProgress(p.totalBytesExpectedToWrite ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0),
  );
  const res = await dl.downloadAsync();
  if (!res || res.status !== 200) throw new ApiError(res?.status ?? 0, 'Download failed');
  const got = await getInfoAsync(file);
  if (info.size && got.exists && got.size !== info.size) throw new Error('The download was incomplete. Try again.');
  onProgress(1);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: await getContentUriAsync(file),
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
