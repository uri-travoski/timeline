import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Comment, type Post } from '../../src/api';
import { timeAgo } from '../../src/state';
import { useTheme } from '../../src/theme';
import { PostCard } from '../../src/components/PostCard';
import { Screen } from '../../src/components/Screen';
import { AgentBadge, Avatar, Button, Empty, Loading, Row, T } from '../../src/components/ui';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: ['post', id], queryFn: () => api.get<Post>(`/posts/${id}`) });
  const comments = useQuery({ queryKey: ['comments', id], queryFn: () => api.get<Comment[]>(`/posts/${id}/comments`) });
  const [text, setText] = useState('');

  // Opening a post (e.g. from a notification) marks it read and clears its notifications.
  useEffect(() => {
    if (post.data?.kind === 'post' && !post.data.isRead) api.post('/reads', { postIds: [post.data.id] }).then(() => qc.invalidateQueries({ queryKey: ['unread'] }));
  }, [post.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => api.post(`/posts/${id}/comments`, { body: text }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['comments', id] });
      qc.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  return (
    <Screen title={post.data?.kind === 'reminder' ? 'Reminder' : 'Post'} back>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
          {post.isLoading ? <Loading /> : post.isError ? <Empty title="Post not found">It may have been deleted.</Empty> : <PostCard post={{ ...post.data!, isRead: true }} expanded />}
          {comments.data?.map((c) => (
            <Row key={c.id} style={{ alignItems: 'flex-start', paddingHorizontal: 14 }} gap={10}>
              <Avatar name={c.author.name} color={c.author.color} kind={c.author.kind} size={32} />
              <View style={{ flex: 1, backgroundColor: t.raised, borderRadius: 5, padding: 10 }}>
                <Row gap={6}>
                  <T bold size={13.5}>{c.author.name}</T>
                  {c.author.kind === 'agent' && <AgentBadge small />}
                  <T muted size={11.5}>{timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}</T>
                </Row>
                <T size={14.5} style={{ marginTop: 3, lineHeight: 20 }}>{c.body}</T>
              </View>
            </Row>
          ))}
        </ScrollView>
        {post.data?.permissions.canComment && post.data.kind === 'post' && (
          <Row style={{ padding: 10, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.panel }}>
            <TextInput value={text} onChangeText={setText} placeholder="Write a comment…" placeholderTextColor={t.muted} multiline
              style={{ flex: 1, color: t.text, backgroundColor: t.card, borderRadius: 7, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 }} />
            <Button title="Send" kind="primary" onPress={() => send.mutate()} disabled={!text.trim()} loading={send.isPending} />
          </Row>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
