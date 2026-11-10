import {meetsMinimumCompanyScale} from './policy.mjs';
import {createReader,KEYWORDS,relevantTitle,text,decode,section,cleanCompany,iso,field,location,experience,checkedDate,companyFacts,selectUrls,interleave,profileFor} from './collector.mjs';
export function saraminLinks(html){
  const blocks=[...html.matchAll(/<h2\b[^>]*class=["'][^"']*job_tit[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi)];
  return [...new Set(blocks.filter(m=>relevantTitle(text(m[1]))).flatMap(m=>[...m[1].matchAll(/rec_idx=(\d+)/g)].map(x=>'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx='+x[1])))];
}
export function parseSaramin(html,url,now=new Date().toISOString()){
  const title=text(section(html,'class','tit_job')),head=section(html,'class','jv_header');
  const link=head.match(/<a\b[^>]*href=["']([^"']*company-info\/view\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
  const company=cleanCompany(link?.[2]||'');if(!title||!company)throw new Error('공고 항목 구조를 확인할 수 없음');if(!relevantTitle(title))return null;
  const id='srm-'+new URL(url).searchParams.get('rec_idx'),how=text(section(html,'class','jv_howto')),summary=text(section(html,'class','jv_summary'));
  if(/마감되었습니다|접수마감/.test(how)||/접수마감/.test(text(head)))return {id,status:'closed',lastVerifiedAt:now};
  const date=how.match(/마감일\s*(20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/),deadline=iso(date?.[1]);
  const rolling=!deadline&&/채용\s*시|상시/.test(how);if(!deadline&&!rolling)throw new Error('마감 상태 확인 불가');
  const deadlineAt=deadline?deadline+'T'+(date?.[2]&&date[2]!=='24'?date[2].padStart(2,'0')+':'+date[3]+':00':'23:59:59')+'+09:00':null;
  const address=text(section(html,'class','jv_location')).replace(/^근무지위치\s*/,'');
  const place=location(address)||location(field(summary,'근무지역','지도보기|최저임금')||'');if(!place)throw new Error('근무 지역 확인 불가');
  const exp=field(summary,'경력','학력')||'경력 조건 확인 필요',employment=field(summary,'근무형태','자격요건|우대사항|급여|직급|근무일시|근무지역')||'원문 확인',pay=field(summary,'급여','직급|근무일시|근무지역|자격요건|우대사항')||'공고 원문 확인';
  const companyHtml=section(html,'class','jv_company'),facts=companyFacts(text(companyHtml),url,'사람인 공고 내 기업정보');
  const job={id,company,initial:company[0],title,...place,...experience(exp),employment,cert:null,certLabel:'세부 자격요건 원문 확인',tags:[],postedAt:iso(how.match(/시작일\s*(20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/)?.[1])||now.slice(0,10),deadline,deadlineAt,rolling,sourceName:'사람인',sourceUrl:url,companyUrl:link?new URL(decode(link[1]),url).href:null,tasks:['담당 업무는 채용공고 원문에서 확인해 주세요.'],requirements:['학력·필수 자격·세부 경력은 원문을 확인해 주세요.'],fitNote:'자동 수집 · 세부 경력·자격요건 원문 확인',factsNote:'채용 법인의 공고 내 기업정보 기준. 제공 기준일을 함께 확인해 주세요.',companyId:id,rank:100,color:'#f7f9f6',status:deadlineAt&&Date.parse(deadlineAt)<Date.parse(now)?'closed':'open',checkedAt:checkedDate(now),lastVerifiedAt:now,sourceKind:'posting',logoUrl:'',pay,...facts};
  const benefitHtml=section(html,'class','jv_benefit'),benefits=[];
  for(const m of benefitHtml.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)){const label=text(m[1].match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1]||''),value=m[1].match(/data-origin=["']([^"']*)["']/)?.[1]||m[1].match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i)?.[1];if(label&&value)benefits.push({label,text:text(value)});}
  return {job,profile:profileFor(job,benefits)};
}
export async function collectSaramin(current,{read=createReader(),now=new Date().toISOString(),limit=100,pages=3,keywords=KEYWORDS,delay=()=>new Promise(r=>setTimeout(r,350))}={}){
  const lists=[],errors=[];let searches=0,failures=0,inspected=0,excluded=0;
  for(let page=1;page<=pages;page++)for(const keyword of keywords){try{const html=await read('https://www.saramin.co.kr/zf_user/search?searchword='+encodeURIComponent(keyword)+'&recruitPage='+page+'&recruitPageCount=40');const links=saraminLinks(html);if(!links.length&&!/채용정보\s*총|검색결과가 없습니다/.test(text(html)))throw new Error('검색 결과 구조 확인 불가');lists.push(links);searches++;}catch(e){failures++;errors.push(e.message);}await delay();}
  const urls=new Set([...current.jobs.filter(j=>j.sourceName==='사람인'&&j.status==='open').map(j=>j.sourceUrl),...interleave(lists)]),{selected,offset}=selectUrls(current,urls,'saramin',limit),jobs=[],profiles=[];
  for(const url of selected){try{const parsed=parseSaramin(await read(url),url,now);inspected++;if(!parsed){excluded++;continue;}if(parsed.status==='closed'){jobs.push(parsed);continue;}if(parsed.job.recruitmentAgency||!meetsMinimumCompanyScale(parsed.job)){excluded++;continue;}jobs.push(parsed.job);profiles.push(parsed.profile);}catch(e){failures++;errors.push(e.message);}await delay();}
  return {id:'saramin',name:'사람인',jobs,profiles,checkedAt:now,success:searches>0&&inspected>0,status:searches&&inspected?(failures?'partial':'ok'):'error',searches,discovered:urls.size,inspected,excluded,failures,truncated:urls.size>selected.length,discoveryOffset:offset,message:errors[0]||null};
}
