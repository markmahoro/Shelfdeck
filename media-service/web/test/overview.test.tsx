import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('Helix Overview product semantics', () => {
  it('opens with collection value and normal system state', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading',{level:1,name:'你的收藏，正在被认真照料'})).toBeInTheDocument();
    expect(screen.getByText('正式收藏')).toBeInTheDocument();
    expect(screen.getByText('正常运行')).toBeInTheDocument();
    expect(screen.queryByText('任务中心')).not.toBeInTheDocument();
  });
  it('presents dangerous actions only as owner-provided fresh projection guidance', () => {
    render(<MemoryRouter initialEntries={['/offdeck']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading',{level:1,name:'建议可以自动生成，销毁必须由你授权'})).toBeInTheDocument();
    expect(screen.getByText(/危险操作只会在 fresh Projection/)).toBeInTheDocument();
  });
});
