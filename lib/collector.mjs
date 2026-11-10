import {request} from './http.mjs';
import {meetsMinimumCompanyScale,REGIONS} from './policy.mjs';
const HOSTS=['www.jobkorea.co.kr','jobkorea.co.kr','hanmi.recruiter.co.kr'];
const KEYWORDS=['안전보건','산업안전','안전관리자','EHS'];
const RELEVANT=/산업\s*안전|안전\s*[·ㆍ/-]?\s*보건|보건\s*관리|환경\s*[·ㆍ/-]?\s*안전|안전\s*[·ㆍ/-]?\s*환경|안전\s*(?:관리|담당)|\b(?:EHS|HSE|SHE)\b/i;
export function decode(s){return String(s??'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(Math.min(0x10ffff,x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1)))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[x.toLowerCase()]));}
export const text=html=>decode(String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const heading=html=>[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(x=>text(x[1])).find(x=>x&&x!=='JOBKOREA');
const field=(s,label,end)=>s.match(new RegExp('(?:'+label+')\\s*([\\s\\S]*?)(?='+end+')'))?.[1]?.trim();
const iso=s=>{const m=String(s??'').match(/(20\d{2})[.\/-](\d{2})[.\/-](\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;};
export function jobLinks(html){return [...new Set([...html.matchAll(/(?:https?:\/\/(?:www\.)?jobkorea\.co\.kr)?\/Recruit\/GI_Read\/(\d+)/gi)].map(m=>'https://www.jobkorea.co.kr/Recruit/GI_Read/'+m[1]))];}
export function parseCompany(html,url){
  const s=text(html),employee=field(s,'사원수','기업구분|설립일|자본금|매출액|대표자'),revenue=field(s,'매출액','대표자|주요사업|사업내용|홈페이지|주소|사원수|영업이익|당기순이익');
  const em=employee?.match(/^([\d,]+)\s*명(?:\s|$|\()/);
  const rv=revenue?.match(/^(?:([\d,.]+)\s*조\s*)?(?:([\d,.]+)\s*억\s*)?(?:([\d,.]+)\s*만\s*)?원/);
  const number=x=>x?Number(x.replaceAll(',','')):0;
  return {employeeCount:em?number(em[1]):null,employeeCountAsOf:employee?.match(/20\d{2}[.\/-]\d{2}[.\/-]\d{2}/)?.[0]||'기준일 미표기',annualRevenueEok:rv&&(rv[1]||rv[2]||rv[3])?number(rv[1])*10000+number(rv[2])+number(rv[3])/10000:null,revenueYear:revenue?.match(/\b(20\d{2})\b/)?.[1]||null,type:s.match(/기업구분\s*(대기업|중견기업|중소기업|스타트업)/)?.[1]||'유형 미확인',listingStatus:/기업구분[^]{0,45}비상장/.test(s)?'unlisted':/기업구분[^]{0,45}(코스피|코스닥|코넥스|상장)/.test(s)?'listed':'unknown',companySources:[{label:'규모: 잡코리아 기업정보',url}]};
}
export function parseJob(html,url,now=new Date().toISOString()){
  // Only the posting body, not recommendations, supplies qualifications and status.
  const main=html.split(/id=["']recommended-section["']/i)[0];
  const s=text(main),title=heading(main);
  const companyLink=[...main.matchAll(/<a\b[^>]*href=["']([^"']*(?:\/Recruit\/Co_Read\/|\/company\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(x=>!text(x[2]).includes('더보기')&&text(x[2]));
  const company=companyLink?text(companyLink[2]).replace(/㈜|\(주\)|주식회사/g,'').trim():null;
  if(!title||!company)throw new Error('공고 항목 구조를 확인할 수 없음');
  if(!RELEVANT.test(title))return null;
  const sourceUrl=new URL(url);sourceUrl.search='';
  const id='jk-'+sourceUrl.pathname.split('/').pop();
  if(/(?:이미\s*)?마감된\s*(?:채용\s*)?공고|접수(?:가)?\s*마감되었습니다|채용이\s*종료되었습니다/.test(s))return {id,status:'closed',lastVerifiedAt:now};
  const deadline=iso(s.match(/마감일\s*(20\d{2}[.\/-]\d{2}[.\/-]\d{2})/)?.[1]);
  const rolling=!deadline&&/마감일\s*(?:상시|채용시)/.test(s);
  if(!deadline&&!rolling)throw new Error('마감 상태 확인 불가');
  const address=field(s,'근무지주소|근무지 주소','지도보기|지원자격')||'';
  const region=REGIONS.find(r=>address.startsWith(r))||null;
  if(!region)throw new Error('근무 지역 확인 불가');
  const exp=field(s,'지원자격\\s*경력','학력')||'경력 조건 확인 필요';
  const range=exp.match(/(\d+)\s*[~∼-]\s*(\d+)\s*년/),minimum=exp.match(/(\d+)\s*년\s*(?:이상|↑)/);
  const min=range?Number(range[1]):minimum?Number(minimum[1]):/무관|신입/.test(exp)?0:null;
  const max=range?Number(range[2]):null;
  const employment=field(s,'고용형태','직급|급여')||'원문 확인';
  const pay=field(s,'급여','근무시간|근무지주소')||'공고 원문 확인';
  const tags=['위험성평가','안전보건','산업안전기사','환경안전','EHS'].filter(t=>s.includes(t));
  // Images/iframes may contain additional mandatory qualifications. Never infer a full match from a keyword.
  return {id,company,initial:company[0],title,region,city:address.slice(region.length).trim().split(' ').slice(0,2).join(' '),exp,min,max,employment,cert:null,certLabel:'세부 자격요건 원문 확인',tags,postedAt:iso(s.match(/시작일\s*(20\d{2}[.\/-]\d{2}[.\/-]\d{2})/)?.[1])||now.slice(0,10),deadline,deadlineAt:deadline?deadline+'T23:59:59+09:00':null,rolling,sourceName:'잡코리아',sourceUrl:sourceUrl.href,companyUrl:new URL(decode(companyLink[1]),url).href,tasks:['담당 업무는 채용공고 원문에서 확인해 주세요.'],requirements:['이미지·첨부 상세의 자격요건을 확인해 주세요.'],fitNote:'자동 수집 · 세부 경력·자격요건 원문 확인',factsNote:'채용 법인 기업정보 기준. 규모를 확인할 수 없는 공고는 제외합니다.',companyId:id,rank:100,color:'#f7f9f6',status:deadline&&Date.parse(deadline+'T23:59:59+09:00')<Date.parse(now)?'closed':'open',checkedAt:now.slice(0,10).replaceAll('-','.'),lastVerifiedAt:now,sourceKind:'posting',logoUrl:'',pay};
}
export function robotsAllowed(content,path){
  let group=[],rules=[],inRules=false;const groups=[];
  for(const raw of content.split('\n')){const line=raw.split('#')[0].trim(),i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).toLowerCase(),value=line.slice(i+1).trim();if(key==='user-agent'){if(inRules){groups.push({group,rules});group=[];rules=[];inRules=false;}group.push(value.toLowerCase());}else if(['allow','disallow'].includes(key)){rules.push({key,value});inRules=true;}}
  groups.push({group,rules});const named=groups.filter(g=>g.group.includes('wisecareerbot')),selected=named.length?named:groups.filter(g=>g.group.includes('*'));
  const applicable=selected.flatMap(g=>g.rules).filter(r=>r.value&&new RegExp('^'+r.value.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replace(/\\\$$/,'$')).test(path)).sort((a,b)=>b.value.length-a.value.length||(a.key==='allow'?-1:1));
  return !applicable.length||applicable[0].key==='allow';
}
export function createReader(transport=request){
  const robots=new Map(),failedOrigins=new Map();
  return async url=>{
    const u=new URL(url);if(!HOSTS.includes(u.hostname))throw new Error('허용하지 않은 채용 사이트');
    if(failedOrigins.has(u.origin))throw failedOrigins.get(u.origin);
    const headers={'User-Agent':'WiseCareerBot/1.0 (personal job alerts; no AI)','Accept':'text/html,application/xhtml+xml'};
    if(!robots.has(u.origin)){try{const r=await transport(u.origin+'/robots.txt',{headers,allowedHosts:HOSTS});if(r.status===404)robots.set(u.origin,'');else if(r.status===200)robots.set(u.origin,r.body.toString('utf8'));else throw new Error('사이트 수집 정책 확인 실패');}catch(e){failedOrigins.set(u.origin,e);throw e;}}
    if(!robotsAllowed(robots.get(u.origin),u.pathname+u.search))throw new Error('사이트 수집 정책에 따라 제외');
    const r=await transport(u.href,{headers,allowedHosts:HOSTS});if(r.status!==200)throw new Error('채용사이트 응답 '+r.status);
    const charset=(String(r.headers?.['content-type']||'')+' '+r.body.subarray(0,1500).toString('ascii')).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
    const html=new TextDecoder(charset).decode(r.body);if(/captcha|access denied|unusual traffic/i.test(text(html).slice(0,300)))throw new Error('사이트 접근 제한');return html;
  };
}
export async function collectJobKorea(current,{read=createReader(),now=new Date().toISOString(),limit=40,delay=()=>new Promise(r=>setTimeout(r,350))}={}){
  const existing=new Map(current.jobs.map(j=>[j.sourceUrl,j]));
  const urls=new Set(current.jobs.filter(j=>j.sourceUrl.includes('jobkorea.co.kr')&&(j.status==='open')).map(j=>j.sourceUrl));
  let searches=0,failures=0;const errors=[];
  for(const keyword of KEYWORDS){try{const html=await read('https://www.jobkorea.co.kr/Search/?stext='+encodeURIComponent(keyword));const found=jobLinks(html);if(!found.length&&!/검색결과가 없습니다|검색 결과가 없습니다|검색 결과\s*0\s*건/.test(text(html)))throw new Error('검색 결과 구조 확인 불가');found.slice(0,30).forEach(u=>urls.add(u));searches++;}catch(e){failures++;errors.push(e.message);}await delay();}
  const jobs=[],profiles=[],companyCache=new Map();let inspected=0,excluded=0;
  const ordered=[...urls]; // Rotate discoveries so a large recurring result set cannot starve later entries.
  const old=ordered.filter(u=>existing.has(u)),fresh=ordered.filter(u=>!existing.has(u)),offset=current.discoveryOffset||0;
  const rotated=fresh.length?[...fresh.slice(offset%fresh.length),...fresh.slice(0,offset%fresh.length)]:[];
  const selected=[...old.slice(0,20),...rotated,...old.slice(20)].slice(0,limit);
  for(const url of selected){try{
    const html=await read(url);const parsed=parseJob(html,url,now);inspected++;
    if(!parsed){excluded++;continue;}
    if(parsed.status==='closed'){jobs.push(parsed);continue;}
    const prior=existing.get(url);
    // A previously reviewed posting retains its source-backed detail; date/status are refreshed separately.
    if(prior&&prior.company.replace(/\s/g,'')===parsed.company.replace(/\s/g,'')&&meetsMinimumCompanyScale(prior)){
      jobs.push({...prior,deadline:parsed.deadline,deadlineAt:parsed.deadlineAt,rolling:parsed.rolling,lastVerifiedAt:now,checkedAt:parsed.checkedAt,status:parsed.status});continue;
    }
    if(!companyCache.has(parsed.companyUrl))companyCache.set(parsed.companyUrl,parseCompany(await read(parsed.companyUrl),parsed.companyUrl));
    const facts=companyCache.get(parsed.companyUrl);if(!meetsMinimumCompanyScale(facts)){excluded++;continue;}
    jobs.push({...parsed,...facts});
    profiles.push({id:parsed.id,company:parsed.company,pay:parsed.pay,payNote:'공고에 표시된 급여. 상세 조건은 원문 확인.',paySource:{url,label:'채용공고 급여'},salary:null,tags:[],benefits:[],benefitKind:'원문 확인',benefitNote:'복지 항목은 자동으로 추정하지 않습니다.',benefitSource:{url,label:'채용공고 복지'},checkedAt:parsed.checkedAt});
  }catch(e){failures++;errors.push(e.message);}await delay();}
  return {id:'jobkorea',name:'잡코리아 공개 공고',jobs,profiles,checkedAt:now,success:searches>0&&inspected>0,status:searches&&inspected?(failures?'partial':'ok'):'error',searches,inspected,excluded,failures,truncated:urls.size>selected.length,discoveryOffset:offset+Math.max(1,selected.filter(u=>!existing.has(u)).length),message:errors[0]||null};
}
