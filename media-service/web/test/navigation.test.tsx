import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('Helix Admin navigation', () => {
  it('contains exactly the nine product journey pages', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href') !== '#main');
    expect(links.map((link) => link.textContent)).toEqual(['◈概览','⌁文件来源','▤收藏架','▦我的收藏','⇢上架进度','✦收藏健康','⌫退出收藏','◎人物','⚙系统设置']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/','/material-fields','/shelves','/collection','/formation','/care','/offdeck','/people','/settings']);
  });
});

