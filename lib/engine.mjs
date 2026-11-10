import {randomUUID,createHash} from 'node:crypto';
import {CADENCE,getAlertCandidates,isOpenJob,jobFingerprint} from './policy.mjs';
import {collectAll,COLLECTOR_VERSION} from './sources.mjs';
export async function applyCollection(store,result,now=new Date().toISOString()){
  await store.update(state=>{
    const feed=state.feed;feed.lastAttemptAt=now;
    const previous=feed.sources.find(s=>s.id===result.id);
    const health={id:result.id,name:result.name,status:result.status,checkedAt:now,lastSuccessAt:result.success?now:previous?.lastSuccessAt||null,searches:result.searches,discovered:result.discovered,accepted:result.jobs.filter(j=>j.status==='open').length,inspected:result.inspected,excluded:result.excluded,failures:result.failures,truncated:result.truncated,message:result.message};
    feed.sources=[...feed.sources.filter(s=>s.id!==result.id),health];
    // A failed search never turns an empty response into a fresh feed or bulk-closes jobs.
    if(result.success){feed.lastSuccessAt=now;feed.checkedAt=now;feed.mode='automated';}
    const jobs=new Map(feed.jobs.map(j=>[j.id,j])),previousIds=new Set(jobs.keys()),known=new Set(feed.jobs.map(jobFingerprint));
    for(const j of result.jobs){const old=jobs.get(j.id);if(j.status==='closed'&&!old)continue;jobs.set(j.id,{...old,...j,firstSeenAt:old?.firstSeenAt||now});}
    feed.jobs=[...jobs.values()];
    const profiles=new Map(feed.companies.map(c=>[c.id,c]));result.profiles.forEach(c=>profiles.set(c.id,c));feed.companies=[...profiles.values()];
    feed.sourceCursors||={};if(result.discoveryOffset!==undefined)feed.sourceCursors[result.id]=result.discoveryOffset;
    // Each source's first successful scan is its baseline. Existing openings are not "new" alerts.
    if(!state.collector[result.id]&&result.success){state.collector[result.id]={initializedAt:now};return;}
    const discovered=result.jobs.filter(j=>j.status==='open'&&!previousIds.has(j.id)&&!known.has(jobFingerprint(j)));
    for(const sub of Object.values(state.subscriptions)){
      if(!sub.settings.enabled)continue;
      const candidates=getAlertCandidates(sub.settings,discovered,Date.parse(now)).filter(j=>Date.parse(j.lastVerifiedAt)>=Date.parse(sub.createdAt));
      for(const job of candidates){if(!state.outbox.some(o=>o.subscriptionId===sub.id&&o.jobIds.includes(job.id)))state.outbox.push({id:randomUUID(),subscriptionId:sub.id,jobIds:[job.id],createdAt:now,dueAt:Math.max(Date.parse(now),sub.lastSentAt?Date.parse(sub.lastSentAt)+CADENCE[sub.settings.cadence]:Date.parse(now)),attempts:0,status:'pending'});}
    }
    // Bound persisted history; terminal delivery IDs are retained long enough to avoid repeated alerts.
    const cutoff=Date.parse(now)-90*86400000;
    state.outbox=state.outbox.filter(o=>o.status==='pending'||Date.parse(o.createdAt)>cutoff);
  });
}
export async function deliverDue(store,send,{now=Date.now()}={}){
  const snapshot=store.snapshot();
  for(const subscription of Object.values(snapshot.subscriptions)){
    const due=snapshot.outbox.filter(o=>o.subscriptionId===subscription.id&&o.status==='pending'&&o.dueAt<=now);
    if(!due.length)continue;
    const ids=new Set(due.flatMap(o=>o.jobIds)),candidates=getAlertCandidates(subscription.settings,snapshot.feed.jobs,now).filter(j=>ids.has(j.id)&&isOpenJob(j,now));
    if(!subscription.settings.enabled||!candidates.length){await store.update(s=>s.outbox.filter(o=>due.some(d=>d.id===o.id)).forEach(o=>o.status='cancelled'));continue;}
    const id=createHash('sha256').update(due.map(o=>o.id).sort().join(':')).digest('base64url').slice(0,32);
    const payload={id,title:'조건에 맞는 새 채용공고 '+candidates.length+'건',body:candidates.slice(0,2).map(j=>j.company+' · '+j.title).join('\n').slice(0,350),url:candidates.length===1?'/?job='+encodeURIComponent(candidates[0].id):'/?new=1'};
    try{
      await send(subscription.subscription,payload,{topic:id});
      await store.update(s=>{due.forEach(d=>{const o=s.outbox.find(x=>x.id===d.id);if(o)o.status='sent';});if(s.subscriptions[subscription.id]){s.subscriptions[subscription.id].lastSentAt=new Date(now).toISOString();s.subscriptions[subscription.id].lastError=null;}});
    }catch(e){await store.update(s=>{
      if([404,410].includes(e.status)){delete s.subscriptions[subscription.id];s.outbox.filter(o=>o.subscriptionId===subscription.id&&o.status==='pending').forEach(o=>o.status='expired');return;}
      const sub=s.subscriptions[subscription.id];if(sub)sub.lastError='알림 서비스 연결 실패';
      due.forEach(d=>{const o=s.outbox.find(x=>x.id===d.id);if(!o)return;o.attempts++;o.dueAt=now+Math.min(3600000,60000*2**Math.min(o.attempts,6));if(o.attempts>=12)o.status='failed';});
    });}
  }
}
export function startScheduler(store,send,{interval=3600000,collect=collectAll,clock=()=>Date.now(),onError=console.error}={}){
  let busy=false,stopped=false,active=Promise.resolve();
  function tick(){if(busy||stopped)return active;busy=true;active=(async()=>{try{
    const now=clock(),next=Date.parse(store.state.feed.nextCheckAt)||0;
    if(now>=next||(collect===collectAll&&store.state.feed.collectorVersion!==COLLECTOR_VERSION)){await store.update(s=>{s.feed.nextCheckAt=new Date(now+interval).toISOString();});let result;try{result=await collect(store.snapshot().feed,{now:new Date(now).toISOString()});}catch(e){result={id:'collection',name:'공고 수집',jobs:[],profiles:[],success:false,status:'error',message:e.message};}for(const item of Array.isArray(result)?result:[result])await applyCollection(store,item,new Date(clock()).toISOString());if(collect===collectAll)await store.update(s=>{s.feed.collectorVersion=COLLECTOR_VERSION;});}
    await deliverDue(store,send,{now:clock()});
  }catch(e){onError(e);}finally{busy=false;}})();return active;}
  const timer=setInterval(tick,30000);timer.unref();queueMicrotask(tick);
  return {tick,async stop(){stopped=true;clearInterval(timer);await active;}};
}
