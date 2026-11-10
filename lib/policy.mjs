export const COMPANY_TYPES=['대기업','중견기업','스타트업','중소기업'];
export const EMPLOYEE_OPTIONS=[['all','전체'],['100','100명 이상'],['500','500명 이상'],['1000','1,000명 이상'],['5000','5,000명 이상'],['10000','10,000명 이상'],['unknown','미확인']];
export const REVENUE_OPTIONS=[['all','전체'],['100','100억 이상'],['500','500억 이상'],['1000','1,000억 이상'],['10000','1조 이상'],['unknown','미확인']];
export const LISTING_OPTIONS=[['all','전체'],['listed','상장'],['unlisted','비상장'],['unknown','미확인']];
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
export const eligibleJobs=(source,now=Date.now())=>source.filter(j=>meetsMinimumCompanyScale(j)&&isOpenJob(j,now));
export const match=j=>Number.isFinite(j.min)&&j.min<=7&&(j.max===null||(Number.isFinite(j.max)&&j.max>=7));
export const getAlertCandidates=(settings,source,now=Date.now())=>eligibleJobs(source,now).filter(j=>(settings.regions||[]).includes(j.region)&&matchesCompanyType(j,validCompanyTypes(settings.types))&&matchesCompanyFilters(j,validOption(settings.employee,EMPLOYEE_OPTIONS),validOption(settings.listing,LISTING_OPTIONS),validOption(settings.revenue,REVENUE_OPTIONS))&&(!settings.strict||(match(j)&&j.cert===true&&!j.fitNote)));
export const CADENCE={hourly:3600000,'3hours':10800000,daily:86400000};
export function sanitizeSettings(s={}) {
  return {enabled:s.enabled===true,strict:s.strict===true,cadence:Object.hasOwn(CADENCE,s.cadence)?s.cadence:'hourly',regions:[...new Set((Array.isArray(s.regions)?s.regions:[]).filter(x=>REGIONS.includes(x)))],types:[...validCompanyTypes(s.types)],employee:validOption(s.employee,EMPLOYEE_OPTIONS),revenue:validOption(s.revenue,REVENUE_OPTIONS),listing:validOption(s.listing,LISTING_OPTIONS)};
}
