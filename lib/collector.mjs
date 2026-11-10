import {request} from './http.mjs';
import {meetsMinimumCompanyScale,REGIONS} from './policy.mjs';
const HOSTS=['www.jobkorea.co.kr','jobkorea.co.kr','www.saramin.co.kr','hanmi.recruiter.co.kr','boards-api.greenhouse.io','careers.apgroup.com'];
export const KEYWORDS=['안전보건','EHS','안전관리자','환경안전','보건관리자','산업안전','HSE','SHE'];
export const RELEVANT=/산업\s*안전|안전\s*[·ㆍ/-]?\s*보건|보건\s*관리|환경\s*[·ㆍ/-]?\s*안전|안전\s*[·ㆍ/-]?\s*환경|안전\s*(?:관리|담당)|\b(?:EHS|HSE|SHE)\b/i;
export function relevantTitle(title){
  return RELEVANT.test(title)&&!(/전기\s*안전/.test(title)&&!/산업\s*안전|안전\s*보건|보건\s*관리|\b(?:EHS|HSE|SHE|PSM)\b/i.test(title))&&!/\b(?:Japan|Taiwan|Vietnam|China|India|Singapore|Indonesia|Thailand|Philippines|Australia)\b|(?:일본|대만|베트남|중국|인도네시아|태국|필리핀|싱가포르|호주)\s*(?:근무|현장|주재|법인)/i.test(title);
}
export function decode(s){return String(s??'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(Math.min(0x10ffff,x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1)))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[x.toLowerCase()]));}
export const text=html=>decode(String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const heading=html=>[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(x=>text(x[1])).find(x=>x&&x!=='JOBKOREA');
export const field=(s,label,end)=>s.match(new RegExp('(?:'+label+')\\s*([\\s\\S]*?)(?='+end+')'))?.[1]?.trim();
export const iso=s=>{const m=String(s??'').match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
export function jobLinks(html){return [...new Set([...html.matchAll(/(?:https?:\/\/(?:www\.)?jobkorea\.co\.kr)?\/Recruit\/GI_Read\/(\d+)/gi)].map(m=>'https://www.jobkorea.co.kr/Recruit/GI_Read/'+m[1]))];}
// Extract one complete HTML element; do not discard content that follows a recommendation widget.
export function section(html,attribute,value){
  const pattern=new RegExp('<([a-z][\\w-]*)\\b[^>]*\\b'+attribute+'=["\\\']'+(attribute==='class'?'[^"\\\']*\\b':'')+value+(attribute==='class'?'\\b[^"\\\']*':'')+'["\\\'][^>]*>','i');
  const start=pattern.exec(html);if(!start)return '';
  const tags=new RegExp('<\\/?'+start[1]+'\\b[^>]*>','gi');tags.lastIndex=start.index;let depth=0,m;
  while((m=tags.exec(html))){depth+=m[0].startsWith('</')?-1:1;if(depth===0)return html.slice(start.index,tags.lastIndex);}return '';
}
export function structuredJobs(html){
  const rows=[];const visit=v=>{if(!v||typeof v!=='object')return;if(v['@type']==='JobPosting'||v['@type']?.includes?.('JobPosting'))rows.push(v);if(Array.isArray(v))v.forEach(visit);else if(v['@graph'])visit(v['@graph']);};
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(m[1]));}catch{}return rows;
}
export const cleanCompany=s=>text(s).replace(/㈜|\(주\)|\(유\)|주식회사|유한회사/g,'').trim();
export const checkedDate=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)).replaceAll('-','.');
export function location(address){
  const aliases={'서울':'서울(?:특별시)?','경기':'경기(?:도)?','인천':'인천(?:광역시)?','부산':'부산(?:광역시)?','대구':'대구(?:광역시)?','광주':'광주(?:광역시)?','대전':'대전(?:광역시)?','울산':'울산(?:광역시)?','세종':'세종(?:특별자치시)?','강원':'강원(?:특별자치도|도)?','충북':'충청북도|충북','충남':'충청남도|충남','전북':'전북특별자치도|전라북도|전북','전남':'전라남도|전남','경북':'경상북도|경북','경남':'경상남도|경남','제주':'제주(?:특별자치도|도)?'};
  const s=String(address).replace(/^\s*(?:대한민국\s*)?(?:\(\d{5}\)\s*)?/,'').trim();
  for(const [region,alias] of Object.entries(aliases)){const m=s.match(new RegExp('^(?:'+alias+')(?:\\s|$)'));if(m)return {region,city:s.slice(m[0].length).trim().split(/\s+/).filter(t=>/(시|군|구|읍|면|동)$/.test(t)).slice(0,2).join(' ')};}return null;
}
export function experience(exp){const range=exp.match(/(\d+)\s*[~∼-]\s*(\d+)\s*년/),minimum=exp.match(/(\d+)\s*년\s*(?:이상|↑)/);return {exp,min:range?Number(range[1]):minimum?Number(minimum[1]):/무관|신입/.test(exp)?0:null,max:range?Number(range[2]):/^신입$/.test(exp.trim())?0:null};}
export function companyFacts(s,url,label='잡코리아 기업정보'){
  const employee=field(s,'사원수\\s*\\*?','기업구분|기업형태|설립일|자본금|매출액|대표자'),revenue=field(s,'매출액\\s*\\*?','대표자|주요사업|사업내용|홈페이지|주소|사원수|영업이익|당기순이익|기업주소');
  const em=employee?.match(/^([\d,]+)\s*명(?:\s|$|\()/),rv=revenue?.match(/^(?:([\d,.]+)\s*조\s*)?(?:([\d,.]+)\s*억\s*)?(?:([\d,.]+)\s*만\s*)?원/),number=x=>x?Number(x.replaceAll(',','')):0;
  const kind=field(s,'기업구분|기업형태','설립일|산업|업종|사원수|대표자')||'';
  return {recruitmentAgency:/(?:업종|산업|주요사업|사업내용)\s*(?:\(업종\))?\s*(?:고용\s*알선|헤드헌팅)/.test(s),employeeCount:em?number(em[1]):null,employeeCountAsOf:employee?.match(/20\d{2}(?:[.\/-]\d{1,2}[.\/-]\d{1,2}|년 기준)/)?.[0]||'기준일 미표기',annualRevenueEok:rv&&(rv[1]||rv[2]||rv[3])?number(rv[1])*10000+number(rv[2])+number(rv[3])/10000:null,revenueYear:revenue?.match(/\b(20\d{2})\b/)?.[1]||null,type:kind.match(/대기업|중견기업|중소기업|스타트업/)?.[0]||'유형 미확인',listingStatus:/비상장/.test(kind)?'unlisted':/코스피|코스닥|코넥스/.test(kind)?'listed':'unknown',companySources:[{label:'규모: '+label,url}]};
}
export function parseCompany(html,url){return companyFacts(text(html),url);}
export function parseJob(html,url,now=new Date().toISOString()){
  const ld=structuredJobs(html)[0];
  const recommendation=section(html,'id','recommended-section');
  const main=recommendation?html.replace(recommendation,''):html;
  const s=text(main),title=ld?.title||heading(main);
  const companyLink=[...main.matchAll(/<a\b[^>]*href=["']([^"']*(?:\/Recruit\/Co_Read\/|\/company\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(x=>!text(x[2]).includes('더보기')&&text(x[2]));
  const company=cleanCompany(ld?.hiringOrganization?.name||companyLink?.[2]||'');
  if(!title||!company)throw new Error('공고 항목 구조를 확인할 수 없음');
  if(!relevantTitle(title))return null;
  const sourceUrl=new URL(url);sourceUrl.search='';const id='jk-'+sourceUrl.pathname.split('/').pop();
  if(/(?:이미\s*)?마감된\s*(?:채용\s*)?공고|접수(?:가)?\s*마감되었습니다|채용이\s*종료되었습니다/.test(s))return {id,status:'closed',lastVerifiedAt:now};
  const deadline=iso(s.match(/마감일\s*(20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/)?.[1])||iso(ld?.validThrough);
  const rolling=!deadline&&/마감일\s*(?:상시|채용\s*시)/.test(s);
  if(!deadline&&!rolling)throw new Error('마감 상태 확인 불가');
  const address=field(s,'근무지주소|근무지 주소','지도보기|지원자격')||ld?.jobLocation?.address?.streetAddress||'';
  const place=location(address);if(!place)throw new Error('근무 지역 확인 불가');
  const exp=field(s,'지원자격\\s*경력','학력')||ld?.experienceRequirements||'경력 조건 확인 필요';
  const employment=field(s,'고용형태','직급|급여')||'원문 확인',pay=field(s,'급여','근무시간|근무지주소')||'공고 원문 확인';
  return {id,company,initial:company[0],title,...place,...experience(exp),employment,cert:null,certLabel:'세부 자격요건 원문 확인',tags:['위험성평가','안전보건','산업안전기사','환경안전','EHS'].filter(t=>s.includes(t)),postedAt:iso(ld?.datePosted)||iso(s.match(/시작일\s*(20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/)?.[1])||now.slice(0,10),deadline,deadlineAt:deadline?deadline+'T23:59:59+09:00':null,rolling,sourceName:'잡코리아',sourceUrl:sourceUrl.href,companyUrl:companyLink?new URL(decode(companyLink[1]),url).href:null,tasks:['담당 업무는 채용공고 원문에서 확인해 주세요.'],requirements:['이미지·첨부 상세의 자격요건을 확인해 주세요.'],fitNote:'자동 수집 · 세부 경력·자격요건 원문 확인',factsNote:'채용 법인 기업정보 기준. 규모를 확인할 수 없는 공고는 제외합니다.',companyId:id,rank:100,color:'#f7f9f6',status:deadline&&Date.parse(deadline+'T23:59:59+09:00')<Date.parse(now)?'closed':'open',checkedAt:checkedDate(now),lastVerifiedAt:now,sourceKind:'posting',logoUrl:ld?.hiringOrganization?.logo||'',pay};
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
export function selectUrls(current,urls,id,limit){
  const existing=new Map(current.jobs.map(j=>[j.sourceUrl,j])),offset=current.sourceCursors?.[id]||0;
  const old=[...urls].filter(u=>existing.has(u)).sort((a,b)=>Date.parse(existing.get(a).lastVerifiedAt||0)-Date.parse(existing.get(b).lastVerifiedAt||0));
  const fresh=[...urls].filter(u=>!existing.has(u)),rotated=fresh.length?[...fresh.slice(offset%fresh.length),...fresh.slice(0,offset%fresh.length)]:[];
  const refresh=Math.min(old.length,Math.ceil(limit*.4));
  const selected=[...old.slice(0,refresh),...rotated,...old.slice(refresh)].slice(0,limit);
  return {existing,selected,offset:offset+Math.max(1,selected.filter(u=>!existing.has(u)).length)};
}
export const interleave=lists=>{const result=new Set();for(let n=0;n<Math.max(0,...lists.map(l=>l.length));n++)for(const list of lists)if(list[n])result.add(list[n]);return result;};
export function profileFor(job,benefits=[]){return {id:job.id,company:job.company,pay:job.pay,payNote:'채용공고에 표시된 급여이며, 회사 평균 연봉과 다릅니다.',paySource:{url:job.sourceUrl,label:'채용공고 급여'},salary:null,tags:[...new Set(benefits.flatMap(b=>b.text.split(/,\s*/)))].filter(t=>t&&!/보험|퇴직금|수당|4대/.test(t)).slice(0,4).map(label=>({label})),benefits,benefitKind:benefits.length?'공고 기재':'원문 확인',benefitNote:'채용공고에 공개된 내용만 표시합니다. 적용 대상과 금액은 원문을 확인해 주세요.',benefitSource:{url:job.sourceUrl,label:'채용공고 복지'},checkedAt:job.checkedAt};}
export async function collectJobKorea(current,{read=createReader(),now=new Date().toISOString(),limit=100,pages=3,keywords=KEYWORDS,delay=()=>new Promise(r=>setTimeout(r,350))}={}){
  const lists=[];let searches=0,failures=0;const errors=[];
  for(let page=1;page<=pages;page++)for(const keyword of keywords){try{const html=await read('https://www.jobkorea.co.kr/Search/?stext='+encodeURIComponent(keyword)+'&Page_No='+page);const found=jobLinks(html);if(!found.length&&!/검색결과가 없습니다|검색 결과가 없습니다|검색 결과\s*0\s*건/.test(text(html)))throw new Error('검색 결과 구조 확인 불가');lists.push(found);searches++;}catch(e){failures++;errors.push(e.message);}await delay();}
  const urls=new Set([...current.jobs.filter(j=>j.sourceName==='잡코리아'&&j.status==='open').map(j=>j.sourceUrl),...interleave(lists)]);
  const {existing,selected,offset}=selectUrls(current,urls,'jobkorea',limit);
  const jobs=[],profiles=[],companyCache=new Map();let inspected=0,excluded=0;
  for(const url of selected){try{
    const parsed=parseJob(await read(url),url,now);inspected++;
    if(!parsed){excluded++;continue;}if(parsed.status==='closed'){jobs.push(parsed);continue;}
    const prior=existing.get(url);
    if(prior&&cleanCompany(prior.company)===parsed.company&&meetsMinimumCompanyScale(prior)){
      jobs.push({...prior,region:parsed.region,city:parsed.city,deadline:parsed.deadline,deadlineAt:parsed.deadlineAt,rolling:parsed.rolling,lastVerifiedAt:now,checkedAt:parsed.checkedAt,status:parsed.status});continue;
    }
    if(!parsed.companyUrl)throw new Error('기업정보 링크 확인 불가');
    if(!companyCache.has(parsed.companyUrl))companyCache.set(parsed.companyUrl,parseCompany(await read(parsed.companyUrl),parsed.companyUrl));
    const facts=companyCache.get(parsed.companyUrl);if(facts.recruitmentAgency||!meetsMinimumCompanyScale(facts)){excluded++;continue;}
    jobs.push({...parsed,...facts});profiles.push(profileFor(parsed));
  }catch(e){failures++;errors.push(e.message);}await delay();}
  return {id:'jobkorea',name:'잡코리아',jobs,profiles,checkedAt:now,success:searches>0&&inspected>0,status:searches&&inspected?(failures?'partial':'ok'):'error',searches,discovered:urls.size,inspected,excluded,failures,truncated:urls.size>selected.length,discoveryOffset:offset,message:errors[0]||null};
}
