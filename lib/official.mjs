import {createReader,RELEVANT,text,decode,iso,location,experience,checkedDate,profileFor} from './collector.mjs';
const API='https://boards-api.greenhouse.io/v1/boards/coupang/jobs';
const CLS={employeeCount:10674,employeeCountAsOf:'국민연금 · 기준일 미표기 / 페이지 갱신 2026.09.01',annualRevenueEok:47214,revenueYear:2025,type:'대기업',listingStatus:'unknown',companySources:[{label:'직원 수: 사람인 기업정보',url:'https://www.saramin.co.kr/zf_user/company-info/view?csn=UHFGUDJkaVM2WjF1dVA4WUVkZTMxdz09'},{label:'2025년 매출: 캐치 기업정보',url:'https://www.catch.co.kr/Comp/CompSummary/JC8624'}]};
const bullets=(html,label)=>{html=html.replace(/<\/?strong\b[^>]*>/gi,'');const start=html.search(new RegExp(label));if(start<0)return [];const part=html.slice(start).match(/<ul\b[^>]*>([\s\S]*?)<\/ul>/i)?.[1]||'';return [...part.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m=>text(m[1])).filter(Boolean).slice(0,5);};
export function parseOfficial(j,now){
  if(!j.title?.startsWith('[쿠팡로지스틱스서비스]')||!RELEVANT.test(j.title)||!/Korea/i.test(j.location?.name||''))return null;
  const html=decode(j.content||''),s=text(html),address=s.match(/(?:경기도|서울특별시|인천광역시)\s+[^]{0,65}/)?.[0];
  let place=address?location(address):null;
  if(!place&&/Seoul/.test(j.location.name))place={region:'서울',city:'상세 근무지 원문 확인'};
  if(!place&&/\(안산\d/.test(j.title))place={region:'경기',city:'안산시'};
  if(!place)return null; // 광주는 경기/광주광역시를 구분할 근거가 없으면 제외.
  const requirements=bullets(html,'자격\\s*요건'),tasks=bullets(html,'업무\\s*내용'),expText=requirements.find(t=>/경력/.test(t))||'경력 조건 확인 필요';
  const exp=experience(expText);exp.exp=exp.min===null?'경력 조건 확인 필요':'경력 '+exp.min+'년 이상';
  const id='coupang-'+j.id,deadline=iso(j.application_deadline),deadlineAt=deadline?deadline+'T23:59:59+09:00':null;
  return {id,company:'쿠팡로지스틱스서비스',initial:'쿠',title:j.title.replace('[쿠팡로지스틱스서비스]','').trim(),...place,...exp,employment:/고용형태는\s*정규직/.test(s)?'정규직':/계약직/.test(j.title)?'계약직':'원문 확인',cert:null,certLabel:requirements.some(t=>t.includes('산업안전기사'))?'산업안전기사 또는 법정 선임 자격':requirements.some(t=>t.includes('산업위생관리기사'))?'산업위생관리기사 또는 간호사 필수':'세부 자격요건 원문 확인',tags:['EHS'],postedAt:iso(j.first_published)||now.slice(0,10),deadline,deadlineAt,rolling:!deadline,sourceName:'쿠팡 공식',sourceUrl:j.absolute_url,tasks:tasks.length?tasks:['담당 업무는 공식 공고를 확인해 주세요.'],requirements:requirements.length?requirements:['지원요건은 공식 공고를 확인해 주세요.'],fitNote:/Business Analyst/.test(j.title)?'데이터 분석·BI 경력 및 SQL·Python 등 필수':'공식 공고 · 학력·세부 경력·필수 자격은 원문 확인',factsNote:'쿠팡로지스틱스서비스 법인 기준. 모회사 인원·매출과 구분합니다.',companyId:id,rank:100,color:'#f7f9f6',status:deadlineAt&&Date.parse(deadlineAt)<Date.parse(now)?'closed':'open',checkedAt:checkedDate(now),lastVerifiedAt:now,sourceKind:'official',logoUrl:'',pay:'공식 공고 급여 미기재',...CLS};
}
export async function collectOfficial(current,{read=createReader(),now=new Date().toISOString(),delay=()=>new Promise(r=>setTimeout(r,350))}={}){
  const result={id:'coupang',name:'쿠팡 공식',jobs:[],profiles:[],checkedAt:now,success:false,status:'error',inspected:0,excluded:0,failures:0,truncated:false};
  try{const data=JSON.parse(await read(API));if(!Array.isArray(data.jobs)||!data.jobs.length)throw new Error('공식 채용 목록 확인 불가');
    const live=new Set(data.jobs.map(j=>'coupang-'+j.id));
    for(const old of current.jobs.filter(j=>j.id.startsWith('coupang-')))if(!live.has(old.id))result.jobs.push({id:old.id,status:'closed',lastVerifiedAt:now});
    const candidates=data.jobs.filter(j=>j.title.startsWith('[쿠팡로지스틱스서비스]')&&RELEVANT.test(j.title)&&/Korea/i.test(j.location?.name||''));result.discovered=candidates.length;
    for(const candidate of candidates){try{const details=JSON.parse(await read(API+'/'+candidate.id));const job=parseOfficial({...candidate,...details},now);result.inspected++;if(!job){result.excluded++;continue;}result.jobs.push(job);result.profiles.push(profileFor(job));}catch(e){result.failures++;result.message=e.message;}await delay();}
    result.success=true;result.status=result.failures?'partial':'ok';
  }catch(e){result.failures++;result.message=e.message;}return result;
}
