import test from 'node:test';
import assert from 'node:assert/strict';
import {employmentTypes,employmentLabel,matchesEmployment,getAlertCandidates,sanitizeSettings} from '../lib/policy.mjs';
test('current contract is distinct from a possible permanent conversion',()=>{
 for(const employment of ['계약직 (근무기간 9개월, 정규직 전환 가능)','계약직 1년, 정규직으로 전환 가능','기간제','촉탁직','무기계약직']){
  const job={employment};assert.deepEqual(employmentTypes(job),['contract']);assert.equal(matchesEmployment(job,'regular'),false);assert.equal(matchesEmployment(job,'contract'),true);
 }
 assert.deepEqual(employmentTypes({employment:'비정규직 · 1년 후 전환 심사'}),['other']);
 assert.deepEqual(employmentTypes({employment:'정규직 전환형 인턴'}),['other']);
 assert.equal(employmentLabel({employment:'정규직 수습기간 3개월'}),'정규직');
 assert.equal(employmentLabel({employment:'신입 · 인턴 실습 포함'}),'인턴');
});
test('mixed hiring terms match both filters without mistaking full-time for permanent',()=>{
 const mixed={employment:'정규직, 계약직 근무형태 상세보기 계약직 3개월, 정규직 전환 가능'};
 assert.deepEqual(employmentTypes(mixed),['regular','contract']);assert.equal(matchesEmployment(mixed,'regular'),true);assert.equal(matchesEmployment(mixed,'contract'),true);
 for(const employment of ['원문 확인','FULL_TIME','고용형태 원문 확인','정규직 여부 미확인',''])assert.deepEqual(employmentTypes({employment}),['unknown']);
 assert.equal(matchesEmployment({employment:'원문 확인'},'all'),true);assert.equal(matchesEmployment({employment:'원문 확인'},'regular'),false);
});
test('notification employment filter uses the same classification and old settings remain unrestricted',()=>{
 const now=Date.parse('2026-11-11T04:00:00+09:00');
 const jobs=['정규직','계약직 정규직 전환 가능','원문 확인','정규직, 계약직'].map((employment,i)=>({id:String(i),title:'안전관리자',company:'검증기업',region:'경기',employeeCount:100,status:'open',deadlineAt:'2026-12-31T23:59:00+09:00',employment}));
 const settings=sanitizeSettings({enabled:true,regions:['경기'],employment:'regular'});
 assert.deepEqual(getAlertCandidates(settings,jobs,now).map(j=>j.id),['0','3']);
 assert.deepEqual(getAlertCandidates({...settings,employment:'contract'},jobs,now).map(j=>j.id),['1','3']);
 assert.equal(getAlertCandidates({enabled:true,regions:['경기']},jobs,now).length,4);
 assert.equal(sanitizeSettings({employment:'invalid'}).employment,'all');
});
