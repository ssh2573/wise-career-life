import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJob,parseCompany,location,selectUrls,relevantTitle} from '../lib/collector.mjs';
import {parseSaramin,saraminLinks} from '../lib/saramin.mjs';
import {collectOfficial,parseOfficial} from '../lib/official.mjs';
import {eligibleJobs} from '../lib/policy.mjs';
const now='2026-11-10T19:00:00Z';
test('JobKorea streamed content after recommendation widget retains deadline; widget does not close posting',()=>{
 const html='<a href="/company/1597028/">한국바스프㈜</a><h1>EHS Specialist</h1><div>고용형태 정규직 급여 회사 내규 근무지주소 전북특별자치도 군산시 소룡동 지도보기 지원자격 경력 경력 (5년이상) 학력 대졸</div><div id="recommended-section"><div>마감된 공고</div></div><div hidden>시작일 2026.10.31 마감일 2026.11.13</div>';
 const job=parseJob(html,'https://www.jobkorea.co.kr/Recruit/GI_Read/1',now);assert.equal(job.deadline,'2026-11-13');assert.equal(job.status,'open');assert.equal(job.checkedAt,'2026.11.11');assert.equal(job.city,'군산시 소룡동');
 const structured=html.replace('마감일 2026.11.13','')+'<script type="application/ld+json">{"@type":"JobPosting","title":"EHS Specialist","validThrough":"2026-11-20T23:59","hiringOrganization":{"name":"한국바스프㈜"}}</script>';
 assert.equal(parseJob(structured,'https://www.jobkorea.co.kr/Recruit/GI_Read/1',now).deadline,'2026-11-20');
});
const saramin='<div class="jv_header"><a href="/zf_user/company-info/view?csn=test">검증기업(주)</a><h1 class="tit_job">안전보건 관리자</h1></div><div class="jv_summary">경력 경력 3년 ↑ 학력 대졸 근무형태 정규직 급여 연봉 5,000만원 근무지역 경기 안산시 지도보기</div><div class="jv_location">근무지위치 (12345) 경기 안산시 단원구</div><div class="jv_howto">시작일 2026.11.01 09:00 마감일 2026.11.30 15:00 입사지원</div><div class="jv_company">기업형태 중견기업, 코스닥 업종 제조업 사원수 * 486 명 (2025년 기준) 설립일 2000년 매출액 * 500억 1,000만원 (2025년 기준) 기업주소 서울</div><div class="jv_benefit"><dl><dt>지원금/보험</dt><dd data-origin="건강검진, 자녀학자금">건강검진...</dd></dl></div><aside>추천: 마감되었습니다</aside>';
test('Saramin extracts source fields and exact deadline time; early close overrides future deadline',()=>{
 const parsed=parseSaramin(saramin,'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1',now);assert.equal(parsed.job.employeeCount,486);assert.equal(parsed.job.annualRevenueEok,500.1);assert.equal(parsed.job.listingStatus,'listed');assert.equal(parsed.job.deadlineAt,'2026-11-30T15:00:00+09:00');assert.equal(parsed.job.min,3);assert.equal(parsed.profile.benefits[0].text,'건강검진, 자녀학자금');assert.equal(parsed.job.cert,null);
 assert.equal(parseSaramin(saramin.replace('입사지원</div>','마감되었습니다.</div>'),'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1',now).status,'closed');
 assert.deepEqual(saraminLinks('<h2 class="job_tit"><a href="/jobs/relay/view?rec_idx=1">안전보건</a></h2><a href="?rec_idx=2">사무</a>'),['https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1']);
});
test('region variants, employment role relevance and parent listing are not conflated',()=>{
 assert.deepEqual(location('대한민국 경기도 평택시 포승읍 하만호길 32'),{region:'경기',city:'평택시 포승읍'});
 assert.deepEqual(location('충청북도 청주시 흥덕구'),{region:'충북',city:'청주시 흥덕구'});
 assert.equal(parseCompany('사원수 500명 기업구분 중견기업 (해외상장법인 자회사) 설립일 2000년','https://example.com').listingStatus,'unknown');
 for(const title of ['전기안전관리자','환경안전팀 전기안전 관리자','SHE Manager Japan'])assert.equal(relevantTitle(title),false);
 assert.equal(relevantTitle('환경·안전보건(SHEQ) 채용'),true);
 assert.equal(parseCompany('사원수 500명 기업구분 중소기업 산업 고용 알선업 위치 서울','https://example.com').recruitmentAgency,true);
});
test('duplicate portals are suppressed only for matching employer, title, locality and opening date',()=>{
 const one={id:'jk-1',company:'검증기업㈜',title:'안전보건 관리자',region:'경기',city:'안산시 단원구',postedAt:'2026-11-01',status:'open',employeeCount:100,deadlineAt:'2026-12-01T00:00:00+09:00'};
 const two={...one,id:'srm-2',company:'(주)검증기업',title:'안전보건관리자'};
 assert.equal(eligibleJobs([one,two],Date.parse(now)).length,1);assert.equal(eligibleJobs([one,{...two,city:'평택시'}],Date.parse(now)).length,2);
});
test('source cursors rotate new discoveries and refresh oldest known listings',()=>{
 const current={jobs:[{sourceUrl:'old-a',lastVerifiedAt:'2026-11-01'},{sourceUrl:'old-b',lastVerifiedAt:'2026-11-10'}],sourceCursors:{saramin:2}};
 assert.deepEqual(selectUrls(current,new Set(['old-b','old-a','one','two','three']),'saramin',3).selected,['old-a','old-b','three']);
});
const official={id:1,title:'[쿠팡로지스틱스서비스] 안전관리자 (화성2)',location:{name:'South Korea'},absolute_url:'https://www.coupang.jobs/en/jobs/?gh_jid=1',first_published:'2026-11-01',content:'<p>근무지 경기도 화성시 병점구 안녕남로 181</p><p>자격 요건</p><ul><li>안전 경력 3년 이상</li><li>산업안전기사</li></ul>'};
test('official feed separates hiring entity and country; successful removal closes only that source',async()=>{
 const parsed=parseOfficial(official,now);assert.equal(parsed.company,'쿠팡로지스틱스서비스');assert.equal(parsed.region,'경기');assert.equal(parsed.min,3);
 assert.equal(parseOfficial({...official,title:'[쿠팡풀필먼트서비스] 안전관리자'},now),null);
 assert.equal(parseOfficial({...official,location:{name:'Taiwan'}},now),null);
 const result=await collectOfficial({jobs:[{id:'coupang-2'},{id:'jk-3'}]},{now,delay:async()=>{},read:async u=>JSON.stringify(u.endsWith('/jobs')?{jobs:[official]}:official)});
 assert.equal(result.success,true);assert.equal(result.jobs.find(j=>j.id==='coupang-2').status,'closed');assert.equal(result.jobs.some(j=>j.id==='jk-3'),false);
 const failed=await collectOfficial({jobs:[{id:'coupang-2'}]},{now,read:async()=>{throw Error('offline')}});assert.equal(failed.success,false);assert.equal(failed.jobs.length,0);
});
test('official AP entry-level posting preserves application time and does not match seven years',async()=>{
 const {parseAmore}=await import('../lib/amore.mjs');const {match}=await import('../lib/policy.mjs');
 const html='<h1>[신입] AMOREPACIFIC 안전관리 담당</h1><span class="jobdescription">아모레퍼시픽은 회사입니다. 근무지 : 용인) 수행 업무 - 위험성평가 2) 자격 요건 - 산업안전기사 필수 3) 우대 사항 ■ 지원 기간 ▷2026년 11월 9일(월) ~ 11월 23일(월) 23:59까지 인턴 실습(3개월)</span>';
 const job=parseAmore(html,'https://careers.apgroup.com/job/example/1/',now);assert.equal(job.deadlineAt,'2026-11-23T23:59:00+09:00');assert.equal(job.min,0);assert.equal(job.max,0);assert.equal(match(job),false);
});
