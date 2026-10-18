import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { TextInput } from './text';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { api, session } from './api';
import { useTheme } from './theme';
import { Button, T } from './components/ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    session.load().then((s) => setServer(s.server || 'http://'));
  }, []);

  const field = { color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 12 } as const;
  const submit = async () => {
    setBusy(true);
    setError('');
    let base = server.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) base = `http://${base}`;
    try {
      const { token } = await api.login(base, email.trim(), password);
      await session.save(base, token);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: 24 }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <Image source={require('../assets/icon.png')} style={{ width: 48, height: 48, borderRadius: 7 }} />
        <T bold size={30}>Timeline</T>
      </View>
      <T muted size={13} style={{ marginBottom: 6 }}>Server address</T>
      <TextInput style={field} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://timeline.example.com" placeholderTextColor={t.muted} />
      <T muted size={13} style={{ marginBottom: 6 }}>Email</T>
      <TextInput style={field} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <T muted size={13} style={{ marginBottom: 6 }}>Password</T>
      <TextInput style={field} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
      {!!error && <T style={{ color: t.danger, marginBottom: 12 }}>{error}</T>}
      <Button title="Sign in" kind="primary" onPress={submit} loading={busy} disabled={!email || !password || server.length < 8} />
      <T muted size={12} style={{ textAlign: 'center', marginTop: 16 }}>Accounts are created by your Timeline admin.</T>
    </KeyboardAvoidingView>
  );
}
