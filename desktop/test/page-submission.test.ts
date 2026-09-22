import assert from 'node:assert/strict';
import test from 'node:test';
import { getCopy } from '../src/shared/copy';
import { SITES } from '../src/main/sites';
import { beginSubmissionRun, effectiveStatus, preserveSubmission, statusForResult, statusForSending } from '../src/main/status';
import { pageSubmissionSummary, pageSiteDetail } from '../src/renderer/page-submission';
import { paginateSiteKeys } from '../src/shared/site-pages';
import type { SiteStatus, SubmissionStatus } from '../src/shared/protocol';
import type { SiteKey } from '../src/shared/contracts';
const copy = getCopy('zh-CN');
const sites = SITES.map(s => s.key);
test('three-site pages count sent, failed, unconfirmed and cancelled independently', () => {
  const cases: [SubmissionStatus['state'][], Record<string, number>][] = [
    [['sent','sent','sent'],{sent:3}], [['failed','failed','failed'],{failed:3}],
    [['failed','cancelled','cancelled'],{failed:1,cancelled:2}],
    [['sent','unconfirmed','cancelled'],{sent:1,unconfirmed:1,cancelled:1}],
    [['sending','sent','failed'],{sending:1,sent:1,failed:1}]
  ];
  for (const [states, expected] of cases) {
    const statuses = Object.fromEntries(sites.map((site, i) => [site, {site,phase:'submitted',submission:{runId:'r',state:states[i%3]}}])) as Record<string, SiteStatus>;
    for (const page of paginateSiteKeys(sites).slice(1)) assert.deepEqual(Object.fromEntries(pageSubmissionSummary(page,statuses,copy).map(b=>[b.state,b.count])),expected);
  }
});
test('page failure retains confirmed delivery and warning; no run means no failure count', () => {
  const sent = statusForResult('kimi',{ok:true,code:'tier_unconfirmed'},'r');
  const generating = preserveSubmission(sent,{site:'kimi',phase:'generating'});
  const crashed = effectiveStatus(generating,{site:'kimi',phase:'crashed',code:'renderer_crashed'});
  assert.equal(pageSubmissionSummary(['kimi'],{kimi:crashed},copy)[0].state,'sent');
  assert.ok(pageSiteDetail('Kimi',crashed,copy).includes(copy.crashed));
  assert.ok(pageSiteDetail('Kimi',crashed,copy).includes(copy.tierUnconfirmed));
  assert.deepEqual(pageSubmissionSummary(['kimi'],{kimi:{site:'kimi',phase:'failed',code:'load_failed'}},copy),[]);
  assert.equal(statusForResult('kimi',{ok:false,code:'submit_unconfirmed'},'r').submission?.state,'unconfirmed');
});
test('new run clears earlier counts; retry preserves other sites and replaces its own state', () => {
  const records = new Map<SiteKey,SiteStatus>([['kimi',statusForResult('kimi',{ok:true},'old')],['claude',statusForResult('claude',{ok:false,code:'error'},'old')]]);
  const emitted:SiteKey[]=[];
  assert.equal(beginSubmissionRun(true,records,site=>emitted.push(site)),true);
  assert.equal(records.get('kimi')?.submission?.state,'sent');
  assert.equal(preserveSubmission(records.get('claude'),statusForSending('claude','old')).submission?.state,'sending');
  assert.equal(beginSubmissionRun(false,records,site=>emitted.push(site)),false);
  assert.deepEqual(emitted,['kimi','claude']);
  assert.ok([...records.values()].every(s=>!s.submission));
});
