import SessionDetailView from '../../../components/SessionDetailView';

export default function SessionDetailPage({ params }) {
  return <SessionDetailView sessionId={params.id} />;
}
