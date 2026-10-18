import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from '../text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot, X } from 'lucide-react-native';
import { abs } from '../api';
import { useTheme } from '../theme';

export function Avatar({ name, color, kind, size = 38, src }: { name: string; color: string; kind?: 'human' | 'agent'; size?: number; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  const uri = abs(src);
  if (uri && !broken) return <Image source={{ uri }} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      {kind === 'agent' ? <Bot size={size * 0.5} color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>}
    </View>
  );
}

export function AgentBadge({ small }: { small?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.accentSoft, borderRadius: 5, paddingHorizontal: small ? 5 : 7, paddingVertical: 1 }}>
      <Bot size={small ? 10 : 11} color={t.accentText} />
      <Text style={{ color: t.accentText, fontSize: small ? 9.5 : 10.5, fontWeight: '700' }}>{small ? 'AI' : 'AI AGENT'}</Text>
    </View>
  );
}

export function T({ children, style, muted, bold, size, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; bold?: boolean; size?: number; numberOfLines?: number }) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: muted ? t.muted : t.text, fontSize: size ?? 15, fontWeight: bold ? '700' : '400' }, style]}>
      {children}
    </Text>
  );
}

export function Chip({ label, on, onPress, icon, color }: { label: string; on?: boolean; onPress?: () => void; icon?: ReactNode; color?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 5, borderWidth: 1, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : t.card }}
    >
      {color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />}
      {icon}
      <Text style={{ color: on ? t.text : t.muted, fontSize: 13, fontWeight: on ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function Button({ title, onPress, kind = 'default', icon, disabled, loading, style }: { title: string; onPress?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; icon?: ReactNode; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> } & Pick<PressableProps, 'onLongPress'>) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : kind === 'ghost' ? 'transparent' : t.raised;
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : t.text;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 7, backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1, borderWidth: kind === 'default' ? 1 : 0, borderColor: t.line }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!!title && <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: 40, gap: 8 }}>
      {icon}
      <T bold size={17}>{title}</T>
      {children && <T muted style={{ textAlign: 'center' }}>{children}</T>}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={t.accent} size="large" />
    </View>
  );
}

/** Bottom sheet style modal. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View style={{ maxHeight: '88%', backgroundColor: t.panel, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: insets.bottom + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
          <T bold size={18} style={{ flex: 1 }}>{title}</T>
          <Pressable onPress={onClose} hitSlop={12}>
            <X color={t.muted} size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer && <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>{footer}</View>}
      </View>
    </Modal>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: 14 }, style]}>{children}</View>;
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}
