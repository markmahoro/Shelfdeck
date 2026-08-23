import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormationStubPage from '../src/helix/FormationStubPage';

describe('Formation interaction stub', () => {
  it('uses one table and opens one centered process dialog per media row', () => {
    render(<FormationStubPage />);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const ghostStoryRow = screen.getByText('倩女幽魂2：人间道 (1990)').closest('tr');
    expect(ghostStoryRow).not.toBeNull();
    fireEvent.click(within(ghostStoryRow as HTMLTableRowElement).getByRole('button', { name: '查看过程' }));

    const dialog = screen.getByRole('dialog', { name: '倩女幽魂2：人间道 (1990)的上架过程详情' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByText('上架过程详情')).toHaveLength(1);
    expect(screen.getByText('已接收的材料')).toBeInTheDocument();
    expect(screen.getByText('媒体整理')).toBeInTheDocument();
    expect(screen.getByText('验收与上架')).toBeInTheDocument();
    expect(screen.getByText('更新并验证 NFO')).toBeInTheDocument();
    expect(screen.queryByText('生成并验证成品 NFO')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const springRow = screen.getByText('一场很（没）有必要的春晚 (2022)').closest('tr');
    expect(springRow).not.toBeNull();
    fireEvent.click(within(springRow as HTMLTableRowElement).getByRole('button', { name: '查看过程' }));
    expect(screen.getByRole('dialog', { name: '一场很（没）有必要的春晚 (2022)的上架过程详情' })).toBeInTheDocument();
    expect(screen.getAllByText('缺少收藏要求中的演员资料')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '关闭上架过程详情' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps completed media in the same table through status filtering', () => {
    render(<FormationStubPage />);

    fireEvent.click(screen.getByRole('button', { name: '已完成 1' }));
    expect(screen.getByText('锡尔弗顿之围 (2022)')).toBeInTheDocument();
    expect(screen.queryByText('倩女幽魂2：人间道 (1990)')).not.toBeInTheDocument();
    expect(screen.getByText('当前显示 1 条')).toBeInTheDocument();
  });

  it('keeps ended media in the same table and gives each row an independent expedite control', () => {
    render(<FormationStubPage />);

    expect(screen.getByText('养蜂人 (2024) · 旧整理记录')).toBeInTheDocument();
    const veniceExpedite = screen.getByRole('button', { name: '取消加急 威尼斯惊魂夜 (2023)' });
    const skyfallExpedite = screen.getByRole('button', { name: '加急 007：大破天幕杀机 (2012)' });
    expect(veniceExpedite).toHaveAttribute('aria-pressed', 'true');
    expect(skyfallExpedite).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(skyfallExpedite);
    expect(screen.getByRole('button', { name: '取消加急 007：大破天幕杀机 (2012)' })).toHaveAttribute('aria-pressed', 'true');
    expect(veniceExpedite).toHaveAttribute('aria-pressed', 'true');

    expect(screen.getByRole('button', { name: '锡尔弗顿之围 (2022)无需加急' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '养蜂人 (2024) · 旧整理记录无需加急' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '倩女幽魂2：人间道 (1990)无需加急' })).toBeDisabled();
  });
});
