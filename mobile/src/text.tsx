import { useSyncExternalStore } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// App-wide text size adjustment in px (Settings → Text size). Every Text/TextInput in the app comes from here.
export const MIN_TEXT_DELTA = -4;
export const MAX_TEXT_DELTA = 10;
const KEY = 'textDelta';
let delta = 0;
const listeners = new Set<() => void>();

SecureStore.getItemAsync(KEY)
  .then((v) => {
    const n = Number(v);
    if (v != null && Number.isFinite(n)) setTextDelta(n, false);
  })
  .catch(() => {});

export function setTextDelta(n: number, persist = true) {
  delta = Math.max(MIN_TEXT_DELTA, Math.min(MAX_TEXT_DELTA, Math.round(n)));
  listeners.forEach((l) => l());
  if (persist) SecureStore.setItemAsync(KEY, String(delta)).catch(() => {});
}

export function useTextDelta() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => delta,
  );
}

function scaled(style: TextProps['style'], d: number, fallback: number) {
  if (!d) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  return [flat, { fontSize: (flat.fontSize ?? fallback) + d, ...(flat.lineHeight ? { lineHeight: flat.lineHeight + d * 1.25 } : null) }];
}

export function Text({ style, ...rest }: TextProps) {
  const d = useTextDelta();
  return <RNText {...rest} style={scaled(style, d, 14)} />;
}

export function TextInput({ style, ...rest }: TextInputProps) {
  const d = useTextDelta();
  return <RNTextInput {...rest} style={scaled(style, d, 14)} />;
}
