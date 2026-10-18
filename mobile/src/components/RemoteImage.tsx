import { useState } from 'react';
import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';
import { Text } from '../text';

/**
 * Remote (server) images. Uses React Native's built-in Image (Fresco on Android), which renders
 * reliably inside recycled list cells; shows the error instead of a silent blank box.
 */
export function RemoteImage({ uri, style, fit = 'cover', showError }: { uri?: string | null; style?: StyleProp<ImageStyle>; fit?: 'cover' | 'contain'; showError?: boolean }) {
  const [err, setErr] = useState('');
  if (!uri) return null;
  return (
    <>
      <Image source={{ uri }} style={style ?? StyleSheet.absoluteFill} resizeMode={fit} fadeDuration={120} onError={(e) => setErr(String(e.nativeEvent.error ?? 'error'))} />
      {showError && !!err && (
        <Text style={{ position: 'absolute', top: 8, left: 8, right: 8, color: '#ef4444', fontSize: 11 }} numberOfLines={3}>
          Couldn't load image: {err}
        </Text>
      )}
    </>
  );
}

export const prefetchImages = (uris: string[]) => uris.forEach((u) => Image.prefetch(u).catch(() => {}));
