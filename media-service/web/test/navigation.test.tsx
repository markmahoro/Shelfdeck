import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Sidebar from '../src/components/Sidebar';

describe('Admin navigation', () => {
  it('contains exactly the eight product pages', () => {
    render(<MemoryRouter><Sidebar open onNavigate={vi.fn()} /></MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['概览', '媒体库', '媒体', '演员', '任务中心', '清理建议', '管理策略', '系统设置']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/libraries', '/media', '/people', '/tasks', '/cleanup', '/policies', '/settings']);
  });
});
