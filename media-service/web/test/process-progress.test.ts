import {expect,it} from 'vitest';
import {progressDetail} from '../src/helix/ProcessStages';
it('renders FFmpeg speed as the reported multiplier, consistent with its ETA',()=>{
  expect(progressDetail({mode:'determinate',currentValue:60_000_000,totalValue:120_000_000,unit:'microseconds',rate:2.5,etaMs:24000})).toBe('50% · 2.50 倍速 · 预计 1 分钟');
});
