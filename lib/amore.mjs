import {createReader,text,decode,section,relevantTitle,checkedDate,profileFor,location} from './collector.mjs';
const ROOT='https://careers.apgroup.com';
export function amoreLinks(html){return [...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']*\/job\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter(m=>relevantTitle(text(m[2]))).map(m=>new URL(decode(m[1]),ROOT).href))];}
export function parseAmore(html,url,now){
 const title=text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||''),s=text(section(html,'class','jobdescription'));
 if(!title||!s)throw new Error('공식 공고 구조 확인 불가');if(!relevantTitle(title)||!title.includes('AMOREPACIFIC')||!s.includes('아모레퍼시픽은'))return null;
 const id='ap-'+new URL(url).pathname.split('/').filter(Boolean).pop();
 const dates=s.match(/지원\s*기간\s*▷?\s*(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일[^~]*~\s*(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일[^\d]*(\d{1,2}):(\d{2})/);
 if(!dates)throw new Error('마감 상태 확인 불가');
 const pad=v=>String(v).padStart(2,'0'),endYear=dates[4]||String(Number(dates[1])+(Number(dates[5])<Number(dates[2])?1:0)),deadline=endYear+'-'+pad(dates[5])+'-'+pad(dates[6]),deadlineAt=deadline+'T'+pad(dates[7])+':'+dates[8]+':00+09:00';
 const loc=s.match(/근무지\s*:\s*([^)]*)/)?.[1]?.trim();const place=location(loc)||({용인:{region:'경기',city:'용인시'},서울:{region:'서울',city:'상세 근무지 원문 확인'},오산:{region:'경기',city:'오산시'}}[loc]);if(!place)throw new Error('근무 지역 확인 불가');
 const entry=/\[신입\]/.test(title),duties=s.match(/수행\s*업무\s*([\s\S]*?)(?:2\)|자격\s*요건)/)?.[1],requirements=s.match(/자격\s*요건\s*([\s\S]*?)(?:3\)|우대\s*사항)/)?.[1];
 return {id,company:'아모레퍼시픽',initial:'아',title,...place,exp:entry?'신입':'경력 조건 확인 필요',min:entry?0:null,max:entry?0:null,employment:/인턴\s*실습/.test(s)?'신입 · 인턴 실습 포함':'원문 확인',cert:null,certLabel:/산업안전기사/.test(requirements||'')?'산업안전기사 등 필수 · 원문 확인':'자격요건 원문 확인',tags:['안전관리'],postedAt:dates[1]+'-'+pad(dates[2])+'-'+pad(dates[3]),deadline,deadlineAt,rolling:false,sourceName:'아모레퍼시픽 공식',sourceUrl:url,tasks:duties?duties.split(/\s*-\s*/).map(t=>t.trim()).filter(Boolean):['업무는 원문을 확인해 주세요.'],requirements:requirements?requirements.split(/\s*-\s*/).map(t=>t.trim()).filter(Boolean):['자격은 원문을 확인해 주세요.'],fitNote:entry?'신입 전형 · 경력직 전형이 아닙니다.':'세부 경력·필수 자격은 원문 확인',factsNote:'아모레퍼시픽 채용 법인의 별도 기준. 지주사 아모레퍼시픽그룹과 구분합니다.',companyId:id,rank:100,color:'#f7f9f6',status:Date.parse(deadlineAt)<Date.parse(now)?'closed':'open',checkedAt:checkedDate(now),lastVerifiedAt:now,sourceKind:'official',logoUrl:'',pay:'공식 공고 급여 미기재',employeeCount:4457,employeeCountAsOf:'2026.06',annualRevenueEok:26537,revenueYear:2025,type:'대기업',listingStatus:'listed',companySources:[{label:'규모·상장: 캐치 기업정보',url:'https://www.catch.co.kr/Comp/CompSummary/387586'}]};
}
export async function collectAmore(current,{read=createReader(),now=new Date().toISOString(),delay=()=>new Promise(r=>setTimeout(r,350))}={}){
 const result={id:'amore',name:'아모레퍼시픽 공식',jobs:[],profiles:[],checkedAt:now,success:false,status:'error',inspected:0,excluded:0,failures:0,truncated:false};
 try{const html=await read(ROOT+'/search');if(!html.includes('/job/'))throw new Error('공식 채용 목록 확인 불가');const urls=new Set([...amoreLinks(html),...current.jobs.filter(j=>j.id.startsWith('ap-')&&j.status==='open').map(j=>j.sourceUrl)]);result.discovered=urls.size;
 for(const url of [...urls].slice(0,30)){try{const job=parseAmore(await read(url),url,now);result.inspected++;if(!job){result.excluded++;continue;}result.jobs.push(job);result.profiles.push(profileFor(job));}catch(e){result.failures++;result.message=e.message;}await delay();}
 result.success=true;result.status=result.failures?'partial':'ok';result.truncated=urls.size>30;
 }catch(e){result.failures++;result.message=e.message;}return result;
}
