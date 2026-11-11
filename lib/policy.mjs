export const COMPANY_TYPES=['대기업','중견기업','스타트업','중소기업'];
export const EMPLOYEE_OPTIONS=[['all','전체'],['100','100명 이상'],['500','500명 이상'],['1000','1,000명 이상'],['5000','5,000명 이상'],['10000','10,000명 이상'],['unknown','미확인']];
export const REVENUE_OPTIONS=[['all','전체'],['100','100억 이상'],['500','500억 이상'],['1000','1,000억 이상'],['10000','1조 이상'],['unknown','미확인']];
export const LISTING_OPTIONS=[['all','전체'],['listed','상장'],['unlisted','비상장'],['unknown','미확인']];
export const EMPLOYMENT_OPTIONS=[['all','전체'],['regular','정규직'],['contract','계약직'],['other','기타·비정규직'],['unknown','미확인']];
// Classify the stated current hiring terms, never FULL_TIME or a future conversion promise.
export function employmentTypes(job){
  const raw=String(job.employment||'').normalize('NFKC').replace(/\s+/g,'');
  const current=raw.replace(/비정규직/g,'').replace(/정규직(?:으로(?:의)?)?(?:채용)?전환/g,'전환').replace(/정규직(?:여부)?(?:미확인|확인필요|원문확인|아님)/g,'');
  const types=[];
  if(current.includes('정규직'))types.push('regular');
  if(/계약직|기간제|촉탁직/.test(raw))types.push('contract');
  if(/인턴|파견직|프리랜서|아르바이트|알바|일용직|위촉직|파트타임/.test(raw)||(!types.length&&raw.includes('비정규직')))types.push('other');
  return types.length?types:['unknown'];
}
export const matchesEmployment=(job,selected='all')=>validOption(selected,EMPLOYMENT_OPTIONS)==='all'||employmentTypes(job).includes(selected);
export function employmentLabel(job){return employmentTypes(job).map(type=>type==='unknown'?'고용형태 미확인':type==='other'?(/인턴/.test(job.employment)?'인턴':/비정규직/.test(job.employment)?'비정규직':'기타'):EMPLOYMENT_OPTIONS.find(([key])=>key===type)[1]).join(' · ');}
export const REGIONS=['서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','경북','경남','제주'];
export const validOption=(value,options)=>options.some(([key])=>key===value)?value:'all';
export const validCompanyTypes=value=>new Set(Array.isArray(value)?value.filter(type=>COMPANY_TYPES.includes(type)):[]);
export const matchesCompanyType=(job,selected)=>selected.size===0||selected.has(job.type);
export const knownEmployeeCount=j=>Number.isInteger(j.employeeCount)&&j.employeeCount>=0;
export const knownRevenue=j=>Number.isFinite(j.annualRevenueEok)&&j.annualRevenueEok>=0;
export const matchesCompanyFilters=(j,size,status,revenue='all')=>(size==='all'||(size==='unknown'?!knownEmployeeCount(j):knownEmployeeCount(j)&&j.employeeCount>=Number(size)))&&(status==='all'||(status==='unknown'?!['listed','unlisted'].includes(j.listingStatus):j.listingStatus===status))&&(revenue==='all'||(revenue==='unknown'?!knownRevenue(j):knownRevenue(j)&&j.annualRevenueEok>=Number(revenue)));
export const MINIMUM_COMPANY_SCALE=Object.freeze({employees:100,revenueEok:100});
export const meetsMinimumCompanyScale=j=>(knownEmployeeCount(j)&&j.employeeCount>=100)||(knownRevenue(j)&&j.annualRevenueEok>=100);
export const isOpenJob=(j,now=Date.now())=>j.status==='open'&&(j.deadlineAt?Number.isFinite(Date.parse(j.deadlineAt))&&Date.parse(j.deadlineAt)>=now:j.rolling===true&&Date.parse(j.lastVerifiedAt)>now-48*3600000);
// Match only postings with the same employer, title, locality, and opening date.
export const jobFingerprint=j=>!j.company||!j.title||!j.region||!j.city||!j.postedAt?'id:'+j.id:[j.company?.replace(/㈜|\(주\)|\(유\)|주식회사|유한회사|\s/g,''),j.title?.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase(),j.region,j.city?.split(' ')[0],j.postedAt].join('|');
export function eligibleJobs(source,now=Date.now()){const seen=new Set();return source.filter(j=>{if(!meetsMinimumCompanyScale(j)||!isOpenJob(j,now))return false;const key=jobFingerprint(j);if(seen.has(key))return false;seen.add(key);return true;});}
export const match=j=>Number.isFinite(j.min)&&j.min<=7&&(j.max===null||(Number.isFinite(j.max)&&j.max>=7));
export const getAlertCandidates=(settings,source,now=Date.now())=>eligibleJobs(source,now).filter(j=>(settings.regions||[]).includes(j.region)&&matchesCompanyType(j,validCompanyTypes(settings.types))&&matchesCompanyFilters(j,validOption(settings.employee,EMPLOYEE_OPTIONS),validOption(settings.listing,LISTING_OPTIONS),validOption(settings.revenue,REVENUE_OPTIONS))&&matchesEmployment(j,settings.employment)&&(!settings.strict||(match(j)&&j.cert===true&&!j.fitNote)));
export const CADENCE={hourly:3600000,'3hours':10800000,daily:86400000};
export function sanitizeSettings(s={}) {
  return {enabled:s.enabled===true,strict:s.strict===true,cadence:Object.hasOwn(CADENCE,s.cadence)?s.cadence:'hourly',regions:[...new Set((Array.isArray(s.regions)?s.regions:[]).filter(x=>REGIONS.includes(x)))],types:[...validCompanyTypes(s.types)],employee:validOption(s.employee,EMPLOYEE_OPTIONS),revenue:validOption(s.revenue,REVENUE_OPTIONS),listing:validOption(s.listing,LISTING_OPTIONS),employment:validOption(s.employment,EMPLOYMENT_OPTIONS)};
}
