import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, type Post } from '../lib/api';
import { PostCard } from '../components/PostCard';
import { Empty, Spinner } from '../components/ui';

export default function PostPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['post', id], queryFn: () => api.get<Post>(`/posts/${id}`) });

  // Opening a post (e.g. from a notification) clears its notifications.
  useEffect(() => {
    if (q.data && q.data.kind === 'post' && !q.data.isRead) {
      api.post('/reads', { postIds: [q.data.id] }).then(() => qc.invalidateQueries({ queryKey: ['unread'] }));
    }
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[720px] px-3 pt-4 sm:px-5">
      <button className="btn btn-ghost btn-sm mb-3" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}>
        <ArrowLeft size={16} /> Back
      </button>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <Empty title="Post not found">It may have been deleted, or you no longer have access.</Empty>
      ) : q.data!.deletedAt ? (
        <Empty title="This post is in the recycle bin">Restore it from the recycle bin to see it here.</Empty>
      ) : (
        <PostCard post={{ ...q.data!, isRead: true }} expanded />
      )}
    </div>
  );
}
