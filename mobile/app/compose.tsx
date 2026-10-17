import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { RemoteImage } from '../src/components/RemoteImage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, FileText, Film, ImagePlus, Paperclip, X } from 'lucide-react-native';
import { abs, api, uploadFile, type Attachment, type Post } from '../src/api';
import { useCategories, useTags } from '../src/state';
import { useTheme } from '../src/theme';
import { Button, Chip, Row, T } from '../src/components/ui';

interface Up {
  key: string;
  uri: string;
  name: string;
  mime: string;
  progress: number;
  att?: Attachment;
  error?: string;
}

export default function Compose() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = useQuery({ queryKey: ['post', id], queryFn: () => api.get<Post>(`/posts/${id}`), enabled: !!id });
  const cats = (useCategories().data ?? []).filter((c) => c.mine);
  const allTags = useTags().data ?? [];
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [existing, setExisting] = useState<Attachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [ups, setUps] = useState<Up[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const p = editing.data;
    if (!p) return;
    setBody(p.body);
    setTitle(p.title);
    setCategory(p.category?.id ?? null);
    setTags(p.tags);
    setExisting(p.attachments);
  }, [editing.data]);
  useEffect(() => {
    if (!id && category === null && cats.length) setCategory(cats.find((c) => c.name === 'Personal')?.id ?? cats[0].id);
  }, [cats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (files: { uri: string; name: string; mime: string }[]) => {
    const list = files.map((f) => ({ ...f, key: `${f.uri}-${Math.random()}`, progress: 0 }));
    setUps((u) => [...u, ...list]);
    for (const f of list) {
      uploadFile(f.uri, f.name, f.mime, (p) => setUps((u) => u.map((x) => (x.key === f.key ? { ...x, progress: p } : x))))
        .then((att) => setUps((u) => u.map((x) => (x.key === f.key ? { ...x, att, progress: 1 } : x))))
        .catch((e) => setUps((u) => u.map((x) => (x.key === f.key ? { ...x, error: e.message } : x))));
    }
  };

  const pickMedia = async (camera = false) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], allowsMultipleSelection: !camera, quality: 1, videoQuality: ImagePicker.UIImagePickerControllerQualityType.High };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    start(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? a.uri.split('/').pop() ?? 'file', mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg') })));
  };
  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    start(r.assets.map((a) => ({ uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream' })));
  };

  const addTag = (raw: string) => {
    const x = raw.trim().replace(/^#/, '');
    if (x && !tags.some((y) => y.toLowerCase() === x.toLowerCase())) setTags([...tags, x]);
    setTagInput('');
  };

  const busy = ups.some((u) => !u.att && !u.error);
  const ready = ups.filter((u) => u.att).map((u) => u.att!.id);
  const canSave = !saving && !busy && !!(body.trim() || title.trim() || ready.length || existing.length);

  const save = async () => {
    setSaving(true);
    try {
      const allTags = tagInput.trim() ? [...tags, tagInput.trim()] : tags;
      const common = { title: title.trim(), body, category, tags: allTags };
      if (id) await api.patch(`/posts/${id}`, { ...common, addAttachmentIds: ready, removeAttachmentIds: removed });
      else await api.post('/posts', { ...common, attachmentIds: ready });
      for (const k of ['posts', 'reels', 'post', 'tags', 'categories']) qc.invalidateQueries({ queryKey: [k] });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const suggestions = tagInput ? allTags.filter((x) => x.name.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(x.name)).slice(0, 5) : [];
  const input = { color: t.text, fontSize: 16 } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: t.bg }}>
      <Row style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderColor: t.line }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X color={t.text} size={24} />
        </Pressable>
        <T bold size={18} style={{ flex: 1, marginLeft: 8 }}>{id ? 'Edit post' : 'New post'}</T>
        <Button title={busy ? 'Uploading…' : id ? 'Save' : 'Post'} kind="primary" onPress={save} disabled={!canSave} loading={saving} style={{ paddingVertical: 8 }} />
      </Row>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <TextInput value={title} onChangeText={setTitle} placeholder="Title (optional)" placeholderTextColor={t.muted} style={[input, { fontSize: 18, fontWeight: '700' }]} />
        <TextInput value={body} onChangeText={setBody} placeholder="What's happening?" placeholderTextColor={t.muted} multiline autoFocus={!id} style={[input, { minHeight: 120, textAlignVertical: 'top' }]} />

        {(existing.length > 0 || ups.length > 0) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {existing.map((a) => (
              <Tile key={a.id} img={abs(a.thumbUrl ?? a.posterUrl ?? (a.kind === 'image' ? a.url : null))} name={a.filename} video={a.kind === 'video'} onRemove={() => (setExisting(existing.filter((x) => x.id !== a.id)), setRemoved([...removed, a.id]))} />
            ))}
            {ups.map((u) => (
              <Tile key={u.key} img={u.mime.startsWith('image/') ? u.uri : undefined} name={u.error ?? u.name} video={u.mime.startsWith('video/')} progress={u.att || u.error ? undefined : u.progress} error={!!u.error} onRemove={() => setUps(ups.filter((x) => x.key !== u.key))} />
            ))}
          </View>
        )}

        <Row gap={10}>
          <Button title="Photos/videos" icon={<ImagePlus size={18} color={t.text} />} onPress={() => pickMedia(false)} style={{ flex: 1 }} />
          <Button title="" icon={<Camera size={18} color={t.text} />} onPress={() => pickMedia(true)} />
          <Button title="" icon={<Paperclip size={18} color={t.text} />} onPress={pickFile} />
        </Row>

        <T muted bold size={12}>CATEGORY</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cats.map((c) => (
            <Chip key={c.id} label={`${c.isPrivate ? '🔒 ' : ''}${c.name}`} color={c.color} on={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />
          ))}
        </View>

        <T muted bold size={12}>TAGS</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {tags.map((x) => (
            <Chip key={x} label={`#${x}  ✕`} on onPress={() => setTags(tags.filter((y) => y !== x))} />
          ))}
          <TextInput
            value={tagInput}
            onChangeText={(v) => (/[ ,]$/.test(v) ? addTag(v.slice(0, -1)) : setTagInput(v))}
            onSubmitEditing={() => addTag(tagInput)}
            placeholder="add tag"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            blurOnSubmit={false}
            style={[input, { minWidth: 100, paddingVertical: 6 }]}
          />
        </View>
        {suggestions.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((s) => (
              <Chip key={s.name} label={`#${s.name}`} onPress={() => addTag(s.name)} />
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Tile({ img, name, video, progress, error, onRemove }: { img?: string; name: string; video?: boolean; progress?: number; error?: boolean; onRemove: () => void }) {
  const t = useTheme();
  return (
    <View style={{ width: 104, height: 104, borderRadius: 7, overflow: 'hidden', backgroundColor: t.raised, borderWidth: 1, borderColor: error ? t.danger : t.line }}>
      {img ? <RemoteImage uri={img} style={{ flex: 1 }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{video ? <Film color={t.muted} /> : <FileText color={t.muted} />}</View>}
      <Text numberOfLines={1} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, color: '#fff', fontSize: 10, padding: 4, backgroundColor: 'rgba(0,0,0,0.55)' }}>{name}</Text>
      {progress !== undefined && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <View style={{ height: 4, width: `${progress * 100}%`, backgroundColor: t.accent }} />
        </View>
      )}
      <Pressable onPress={onRemove} hitSlop={8} style={{ position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 3 }}>
        <X size={13} color="#fff" />
      </Pressable>
    </View>
  );
}
