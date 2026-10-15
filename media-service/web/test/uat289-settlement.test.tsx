import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import InputSettlementAuthorization from '../src/helix/InputSettlementAuthorization';
import { SessionProvider } from '../src/helix/session';
import { helixAdminApi, type FormationSubject, type SetupReadinessProjection } from '../src/helix/api';

afterEach(() => vi.restoreAllMocks());
beforeEach(()=>{vi.spyOn(helixAdminApi,'listJavCorrectionWork').mockResolvedValue({items:[],counts:{},nextCursor:null});});

it('opens the requested authorization configuration without granting it and restores focus on cancel', async () => {
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const readiness={data:{standingInputSettlement:null}} as SetupReadinessProjection;
  vi.spyOn(helixAdminApi,'getSetupReadiness').mockResolvedValue(readiness);
  const grant=vi.spyOn(helixAdminApi,'setInputSettlementAuthorization');
  render(<MemoryRouter><SessionProvider><InputSettlementAuthorization openRequested /></SessionProvider></MemoryRouter>);
  const dialog=await screen.findByRole('dialog',{name:'自动清理残留文件'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'授权自动清理'})).toBeEnabled());
  expect(dialog).toHaveTextContent('共享、未知及范围外文件');
  expect(grant).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'取消',exact:true}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'自动清理残留文件 未授权'})).toHaveFocus();
  expect(grant).not.toHaveBeenCalled();
});

it('keeps nine Formation columns and exposes the same configuration destination from list and detail', async () => {
  const item={formationViewId:'settlement-view',subjectId:'settlement-subject',displayIdentity:'Series waiting',
    contentProfile:'series',classification:'in_progress',status:'active',structureKind:'season',addedAtMs:1,
    myRating:0,myRatingSource:'douban',organizingRequirement:'HEVC',organizingSteps:[],
    targetShelfName:'Series Shelf',routingState:'resolved',currentRun:{state:'active'},handoffB:{offerId:'offer'},
    nextAction:{label:'处理原有输入',state:'waiting_for_external',progress:null},
    currentPlan:{stageKey:'acceptance_shelving',planId:'plan',planNumber:1,title:'写入收藏架',label:'处理原有输入',
      state:'running',statusText:'等待自动清理授权',progress:null,configurationTarget:'input_settlement_authorization'},
    processDetail:{contract:'formation_process_actual_plans@1',stages:[]}} as unknown as FormationSubject;
  const summary={totalCount:1,inProgressCount:1,attentionRequiredCount:0,completedCount:0},projection={status:'ready' as const,asOfMs:1};
  vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({items:section==='active'?[item]:[],summary,nextCursor:null,projection}));
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'getFormation').mockResolvedValue(item);
  const grant=vi.spyOn(helixAdminApi,'setInputSettlementAuthorization');
  render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
  await screen.findByRole('button',{name:'清理设置'});
  expect(screen.getAllByRole('columnheader')).toHaveLength(9);
  expect(screen.getByText('等待自动清理授权')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
  await screen.findByRole('dialog');
  expect(screen.getAllByRole('button',{name:'清理设置'})).toHaveLength(2);
  expect(grant).not.toHaveBeenCalled();
});
