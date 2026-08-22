import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('Helix Admin navigation', () => {
  it('contains exactly the eight official pages', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    const links = screen.getAllByRole('link').filter((link) => {
      const href = link.getAttribute('href');
      return href !== '#main' && link.closest('nav');
    });
    expect(links.map((link) => link.textContent)).toEqual([
      '概览', '我的收藏', '媒体整理工作区', '退出收藏', '人物', '文件来源配置', '收藏架配置', '系统设置',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/', '/collection', '/formation', '/offdeck', '/people', '/material-fields', '/shelves', '/settings',
    ]);
    expect(links.some((link) => link.getAttribute('href') === '/care')).toBe(false);
  });
});
