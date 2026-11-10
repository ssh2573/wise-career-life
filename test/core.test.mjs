import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {meetsMinimumCompanyScale,getAlertCandidates,sanitizeSettings} from '../lib/policy.mjs';
import {parseJob,parseCompany,collectJobKorea,robotsAllowed,createReader} from '../lib/collector.mjs';
import {applyCollection,deliverDue,startScheduler} from '../lib/engine.mjs';
import {encryptPayload,authorization,generateKeys,validSubscription,sendPush} from '../lib/push.mjs';
const NOW=Date.parse('2026-11-11T01:00:00+09:00'),stamp=n=>new Date(n).toISOString();
const job=(extra={})=>({id:'jk-1',company:'검증 기업',title:'안전관리자',region:'경기',min:3,max:null,cert:true,fitNote:'',employeeCount:100,annualRevenueEok:null,type:'중소기업',listingStatus:'unlisted',status:'open',sourceUrl:'https://www.jobkorea.co.kr/Recruit/GI_Read/1',deadlineAt:'2026-12-30T23:59:59+09:00',...extra});
const settings=sanitizeSettings({enabled:true,strict:true,regions:['경기'],cadence:'hourly'});
const result=(jobs=[],extra={})=>({id:'jobkorea',name:'잡코리아',success:true,status:'ok',jobs,profiles:[],inspected:jobs.length||1,...extra});
async function store(t){const dir=await mkdtemp(join(tmpdir(),'wise-career-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return new Store(dir).init({checkedAt:stamp(NOW-86400000),jobs:[],companies:[]});}
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-endpoint',keys:{p256dh:'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',auth:'BTBZMqHH6r4Tts7J_aSIgg'}};
test('minimum scale is employees OR revenue, independent of company type/listing',()=>{
  for(const record of [job({employeeCount:100}),job({employeeCount:99,annualRevenueEok:100})])assert.equal(meetsMinimumCompanyScale(record),true);
  for(const record of [job({employeeCount:99,annualRevenueEok:99}),job({employeeCount:null,annualRevenueEok:null,type:'대기업',listingStatus:'listed'}),job({employeeCount:'100',annualRevenueEok:NaN})])assert.equal(meetsMinimumCompanyScale(record),false);
  assert.equal(getAlertCandidates(settings,[job(),job({id:'closed',status:'closed'}),job({id:'expired',deadlineAt:stamp(NOW-1)}),job({id:'unknown',cert:null}),job({id:'region',region:'서울'})],NOW).length,1);
});
test('first scan is baseline; only later discoveries notify once across restarts',async t=>{
  const db=await store(t);await db.update(s=>{s.subscriptions.one={id:'one',subscription,settings,createdAt:stamp(NOW-1),lastSentAt:null};});
  await applyCollection(db,result([job({lastVerifiedAt:stamp(NOW)})]),stamp(NOW));assert.equal(db.state.outbox.length,0);
  const next=job({id:'jk-2',lastVerifiedAt:stamp(NOW+1000)});
  await applyCollection(db,result([next]),stamp(NOW+1000));assert.equal(db.state.outbox.length,1);
  const sent=[];await deliverDue(db,async(_,payload)=>sent.push(payload),{now:NOW+1000});assert.equal(sent.length,1);
  const restarted=await new Store(db.directory).init({});await applyCollection(restarted,result([next]),stamp(NOW+2000));await deliverDue(restarted,async()=>sent.push('duplicate'),{now:NOW+2000});assert.equal(sent.length,1);
});
test('failed source preserves last success and postings; never bulk-closes',async t=>{
  const db=await store(t);await applyCollection(db,result([job()]),stamp(NOW));await applyCollection(db,result([],{success:false,status:'error',message:'timeout'}),stamp(NOW+1000));assert.equal(db.state.feed.lastSuccessAt,stamp(NOW));assert.equal(db.state.feed.jobs[0].status,'open');assert.equal(db.state.feed.sources[0].status,'error');
});
test('daily cadence queues new jobs and cancels jobs closed before delivery',async t=>{
  const db=await store(t);await applyCollection(db,result(),stamp(NOW));await db.update(s=>{s.subscriptions.one={id:'one',subscription,settings:{...settings,cadence:'daily'},createdAt:stamp(NOW),lastSentAt:stamp(NOW)};});
  await applyCollection(db,result([job({lastVerifiedAt:stamp(NOW+1000)})]),stamp(NOW+1000));assert.equal(db.state.outbox[0].dueAt,NOW+86400000);
  await deliverDue(db,()=>assert.fail('too early'),{now:NOW+2000});
  await applyCollection(db,result([{id:'jk-1',status:'closed'}]),stamp(NOW+3000));await deliverDue(db,()=>assert.fail('closed job sent'),{now:NOW+86400001});assert.equal(db.state.outbox[0].status,'cancelled');
});
test('expired subscriptions removed; transient errors retain queued jobs with backoff',async t=>{
  const db=await store(t);await applyCollection(db,result(),stamp(NOW));await db.update(s=>{s.subscriptions.one={id:'one',subscription,settings,createdAt:stamp(NOW)};});await applyCollection(db,result([job({lastVerifiedAt:stamp(NOW+1)})]),stamp(NOW+1));
  await deliverDue(db,async()=>{throw Object.assign(new Error('busy'),{status:503});},{now:NOW+1});assert.equal(db.state.outbox[0].attempts,1);assert.ok(db.state.outbox[0].dueAt>NOW+1);
  await deliverDue(db,async()=>{throw Object.assign(new Error('gone'),{status:410});},{now:NOW+3600000});assert.equal(db.state.subscriptions.one,undefined);assert.equal(db.state.outbox[0].status,'expired');
});
test('single-flight scheduler persists its next run and does not collect every tick',async t=>{
  const db=await store(t);let calls=0,now=NOW;const runner=startScheduler(db,async()=>{},{clock:()=>now,collect:async()=>{calls++;return result();}});t.after(()=>runner.stop());await runner.tick();await runner.tick();assert.equal(calls,1);now+=3600001;await runner.tick();assert.equal(calls,2);
});
// Compact fixtures mirror the public h1/link and label fields observed on JobKorea.
const html='<h1><img alt="JOBKOREA"></h1><a href="https://www.jobkorea.co.kr/Recruit/Co_Read/C/123"><h2>㈜검증 기업</h2></a><h1>환경안전담당 경력 채용</h1><div>고용형태 정규직 직급/직책 급여 연봉 3,600~5,000만원 근무시간 주5일 근무지주소 경기 화성시 남양읍 지도보기 지원자격 경력 경력 (3년이상) 학력 무관 접수기간 시작일 2026.11.09(월) 마감일 2026.12.09(수)</div><div id="recommended-section">다른 기업의 마감된 공고</div>';
const company='<h1>검증 기업</h1><div>사원수 198명 (2025.12.31) 기업구분 중소기업 (비상장) 설립일 2000.01.01 자본금 10억 매출액 641억 1,000만원 (2025) 대표자</div>';
test('parser reads actual labels, ignores recommendations, does not infer a certificate match',()=>{
  const parsed=parseJob(html,'https://www.jobkorea.co.kr/Recruit/GI_Read/123',stamp(NOW));assert.equal(parsed.company,'검증 기업');assert.equal(parsed.region,'경기');assert.equal(parsed.min,3);assert.equal(parsed.status,'open');assert.equal(parsed.cert,null);assert.equal(parsed.deadline,'2026-12-09');assert.equal(parsed.pay,'연봉 3,600~5,000만원');
  const facts=parseCompany(company,'https://www.jobkorea.co.kr/Recruit/Co_Read/C/123');assert.equal(facts.employeeCount,198);assert.equal(facts.annualRevenueEok,641.1);assert.equal(facts.listingStatus,'unlisted');
  assert.equal(parseCompany(company.replace('198명','51 ~ 300명 이하'),'https://example.com').employeeCount,null);
  assert.throws(()=>parseJob('<h1>로그인</h1>','https://www.jobkorea.co.kr/Recruit/GI_Read/1'));
});
test('collector discovers, enriches and excludes firms below the mandatory threshold',async()=>{
  const read=async url=>url.includes('/Search/')?'<a href="/Recruit/GI_Read/123">환경안전</a>':url.includes('/Co_Read/')?company:html;
  const collected=await collectJobKorea({jobs:[]},{read,now:stamp(NOW),delay:async()=>{}});assert.equal(collected.jobs.length,1);assert.equal(collected.jobs[0].employeeCount,198);assert.equal(collected.status,'ok');
  const small=await collectJobKorea({jobs:[]},{read:async u=>u.includes('/Co_Read/')?company.replace('198명','20명').replace('641억 1,000만원','40억원'):read(u),now:stamp(NOW),delay:async()=>{}});assert.equal(small.jobs.length,0);assert.equal(small.excluded,1);
});
test('robots policy is respected; foreign redirect/links cannot become collector targets',async()=>{
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /Search/','/Search/?q=1'),false);assert.equal(robotsAllowed('User-agent: *\nDisallow: /\nAllow: /Recruit/','/Recruit/GI_Read/1'),true);
  const reader=createReader(async()=>({status:200,body:Buffer.from('User-agent: *\nDisallow: /')}));await assert.rejects(reader('https://www.jobkorea.co.kr/Search/'));await assert.rejects(reader('https://127.0.0.1/private'));
});
test('RFC 8291 Appendix A encryption vector matches exactly',()=>{
  const encrypted=encryptPayload(subscription,'When I grow up, I want to be a watermelon',{salt:Buffer.from('DGv6ra1nlYgDCS1FRnbzlw','base64url'),privateKey:Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw','base64url')});
  assert.equal(encrypted.subarray(86).toString('base64url'),'8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');assert.equal(encrypted.readUInt32BE(16),4096);
});
test('VAPID signatures verify and target only the push service audience',()=>{
  const keys=generateKeys(),auth=authorization(subscription.endpoint,keys,'https://careers.example.com',NOW),token=auth.match(/t=([^,]+)/)[1],parts=token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.exp,Math.floor(NOW/1000)+43200);
  const pub=Buffer.from(keys.publicKey,'base64url'),key=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')}});
  assert.equal(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
});
test('push delivery rejects SSRF addresses and malformed keys; propagates expiry',async()=>{
  assert.equal(validSubscription(subscription),true);for(const endpoint of ['https://localhost/private','https://fcm.googleapis.com.evil.test/p','https://fcm.googleapis.com:444/p','http://fcm.googleapis.com/p'])assert.equal(validSubscription({...subscription,endpoint}),false);
  assert.equal(validSubscription({...subscription,keys:{...subscription.keys,p256dh:'bad'}}),false);
  await assert.rejects(sendPush(subscription,{id:'test'},generateKeys(),'https://example.com',{transport:async()=>({status:410,headers:{}})}),e=>e.status===410);
});
export {subscription};
test('new sources establish separate baselines and duplicate portal postings do not alert again',async t=>{
 const db=await store(t),base=job({city:'수원시',postedAt:'2026-11-01',lastVerifiedAt:stamp(NOW)});
 await applyCollection(db,result([base]),stamp(NOW));await db.update(s=>{s.subscriptions.one={id:'one',subscription,settings,createdAt:stamp(NOW)};});
 await applyCollection(db,result([job({id:'srm-new',city:'평택시',postedAt:'2026-11-02'})],{id:'saramin'}),stamp(NOW+1));assert.equal(db.state.outbox.length,0);
 await applyCollection(db,result([{...base,id:'srm-duplicate'}],{id:'saramin'}),stamp(NOW+2));assert.equal(db.state.outbox.length,0);
 await applyCollection(db,result([job({id:'srm-really-new',title:'환경안전 담당',city:'화성시',postedAt:'2026-11-11',lastVerifiedAt:stamp(NOW+3)})],{id:'saramin'}),stamp(NOW+3));assert.equal(db.state.outbox.length,1);
});
