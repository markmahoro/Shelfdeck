import type { SurfacePage } from './surface-model';
import { PageHeader } from './chrome';

export default function HelixPage({ page }: { page: SurfacePage }) {
  return <div className="source-page">
    <PageHeader title={page.title} description={page.description} />
  </div>;
}
