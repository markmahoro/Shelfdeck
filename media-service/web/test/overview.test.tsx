import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ health: vi.fn(), space: vi.fn(), libraries: vi.fn() }));
vi.mock('../src/api/client', () => ({
  dashboardHealth: { get: mocks.health },
  spaceStats: { get: mocks.space },
  subLibraries: { list: mocks.libraries },
}));
import OverviewPage from '../src/pages/OverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OverviewPage /></QueryClientProvider>);
}

const health = (status: 'green' | 'red') => ({ status, generatedAt: '2026-07-10T00:00:00.000Z', media: { totalItems: 10, openItems: 10, closedItems: 0, maintenanceCompleteItems: 8, metadataIncompleteItems: 1 }, automation: { enabledTaskTargets: [], allowedOptimizeFlows: [] } });

describe('Overview product semantics', () => {
  beforeEach(() => {
    mocks.space.mockResolvedValue({ realizedReclaimedBytes: 1024 ** 4, reclaimableBytes: 20 * 1024 ** 3, optimize: { itemCount: 6 } });
  });

  it('shows unconfigured instead of a failure wall when no library exists', async () => {
    mocks.health.mockResolvedValue(health('red'));
    mocks.libraries.mockResolvedValue({ subLibraries: [] });
    renderPage();
    expect(await screen.findByText('尚未配置')).toBeInTheDocument();
    expect(screen.queryByText('系统故障')).not.toBeInTheDocument();
  });

  it('shows outcomes and a single normal operating state', async () => {
    mocks.health.mockResolvedValue(health('green'));
    mocks.libraries.mockResolvedValue({ subLibraries: [{ uuid: 'library', libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto' }] });
    renderPage();
    expect(await screen.findByText('系统运行正常')).toBeInTheDocument();
    expect(screen.getByText('1.0 TB')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});
