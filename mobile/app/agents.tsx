import { FlatList, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react-native';
import { api } from '../src/api';
import { timeAgo } from '../src/state';
import { useTheme } from '../src/theme';
import { Screen } from '../src/components/Screen';
import { Avatar, Card, Empty, Loading, Row, T } from '../src/components/ui';

export default function Agents() {
  const t = useTheme();
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<any[]>('/agents') });
  const tasks = useQuery({ queryKey: ['agent-tasks'], queryFn: () => api.get<any[]>('/agent-tasks') });
  return (
    <Screen title="AI agents" back>
      {agents.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={agents.data ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={<Empty icon={<Bot size={40} color={t.muted} />} title="No agents yet">Create agents and their API keys in the web app (AI agents page).</Empty>}
          renderItem={({ item: a }) => (
            <Card style={{ opacity: a.disabled ? 0.5 : 1 }}>
              <Row gap={10}>
                <Avatar name={a.name} color={a.color} kind="agent" size={36} />
                <View style={{ flex: 1 }}>
                  <T bold>{a.name}</T>
                  <T muted size={12}>{a.postCount} posts{a.keys[0]?.lastUsedAt ? ` · active ${timeAgo(a.keys[0].lastUsedAt)}` : ''}</T>
                </View>
              </Row>
              {!!a.description && <T size={13.5} style={{ marginTop: 8 }}>{a.description}</T>}
              {(tasks.data ?? []).filter((x) => x.agentId === a.id).map((x) => (
                <View key={x.id} style={{ marginTop: 8, padding: 10, borderRadius: 5, backgroundColor: t.raised }}>
                  <T bold size={13.5}>{x.name}</T>
                  <T muted size={12}>{x.schedule ? `${x.schedule} · ` : ''}last run {x.lastRunAt ? timeAgo(x.lastRunAt) : 'never'}{x.lastResult ? ` · ${x.lastResult}` : ''}</T>
                </View>
              ))}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
