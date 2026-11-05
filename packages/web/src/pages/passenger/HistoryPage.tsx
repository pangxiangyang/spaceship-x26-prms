import type { Booking, HistorySummary } from '../../api/types';
import { HistoryView } from '../../components/HistoryView';
import { ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { useApiData } from '../../hooks/useApiData';

export function HistoryPage() {
  const { data, error, loading } = useApiData(
    (api) => api.get<{ summary: HistorySummary; entries: Booking[] }>('/api/history'),
    [],
  );
  return (
    <>
      <PageHeader
        title="My history"
        subtitle="Your resource use and well-being trends during the voyage."
      />
      <ErrorBanner error={error} />
      {loading && !data && <Loading />}
      {data && <HistoryView summary={data.summary} entries={data.entries} />}
    </>
  );
}
