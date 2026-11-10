import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {Store} from './lib/store.mjs';
import {generateKeys,validSubscription,sendPush} from './lib/push.mjs';
import {sanitizeSettings,eligibleJobs} from './lib/policy.mjs';
import {startScheduler} from './lib/engine.mjs';
import {networkAgent} from './lib/http.mjs';
import {acquireLock} from './lib/lock.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const hash=token=>createHash('sha256').update(String(token)).digest('hex');
function error(message,status=400){return Object.assign(new Error(message),{status});}
async function body(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw error('요청이 너무 큽니다',413);parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw error('잘못된 요청입니다');}}
const ASSETS=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/lib/policy.mjs',['lib/policy.mjs','text/javascript; charset=utf-8']],['/client.mjs',['client.mjs','text/javascript; charset=utf-8']],['/sw.js',['sw.js','text/javascript; charset=utf-8']],['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json']],['/icon.svg',['icon.svg','image/svg+xml']]]);
export function publicOrigin(env=process.env){return env.PUBLIC_ORIGIN||(env.RAILWAY_PUBLIC_DOMAIN?`https://${env.RAILWAY_PUBLIC_DOMAIN}`:`http://127.0.0.1:${Number(env.PORT)||4173}`);}
export async function createApp({directory=process.env.DATA_DIR?resolve(process.env.DATA_DIR):resolve(ROOT,'.runtime'),origin=publicOrigin(),scheduler=true,send,collect,clock=()=>Date.now(),lock=true}={}){
  const originURL=new URL(origin);if(originURL.origin!==origin||!(originURL.protocol==='https:'||(originURL.protocol==='http:'&&['127.0.0.1','localhost'].includes(originURL.hostname))))throw Error('PUBLIC_ORIGIN에는 정확한 HTTPS 주소가 필요합니다.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const releaseLock=lock?await acquireLock(directory):null;
  const seed=JSON.parse(await readFile(resolve(ROOT,'data/seed.json'),'utf8'));
  const store=await new Store(directory).init(seed);
  if(!store.state.keys)await store.update(s=>{s.keys=generateKeys();});
  const subject=process.env.VAPID_SUBJECT||origin;
  const push=send||((subscription,payload,options)=>sendPush(subscription,payload,store.state.keys,subject,options));
  const limits=new Map();
  function authenticate(req,id){const token=req.headers.authorization?.replace(/^Bearer /,'')||'',sub=store.state.subscriptions[id];if(!sub||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(sub.tokenHash)))throw error('알림 등록 정보를 확인할 수 없습니다. 다시 연결해 주세요.',401);return sub;}
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try{
      if(req.url==='/healthz'&&req.method==='GET')return json(res,200,{ok:true});
      if(req.headers.host!==originURL.host)throw error('허용하지 않은 접속 주소',403);
      const url=new URL(req.url,origin),path=url.pathname;
      if(path.startsWith('/api/')){
        if(req.method!=='GET'){
          if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))throw error('이 웹페이지에서 다시 시도해 주세요.',403);
          const ip=req.socket.remoteAddress,now=clock();let limit=limits.get(ip);if(!limit||limit.until<now){limit={count:0,until:now+600000};limits.set(ip,limit);}if(++limit.count>100)throw error('잠시 후 다시 시도해 주세요.',429);
          if(limits.size>10000)for(const [key,val] of limits)if(val.until<now)limits.delete(key);
        }
        if(path==='/api/feed'&&req.method==='GET'){
          const feed=store.snapshot().feed;
          return json(res,200,{...feed,jobs:eligibleJobs(feed.jobs,clock()),collectionIntervalMinutes:Number(process.env.COLLECT_INTERVAL_MINUTES)||60,serverTime:new Date(clock()).toISOString(),collecting:scheduler});
        }
        if(path==='/api/config'&&req.method==='GET')return json(res,200,{publicKey:store.state.keys.publicKey,pushEnabled:true,collectionEnabled:scheduler,origin});
        if(path==='/api/subscriptions'&&req.method==='POST'){
          const data=await body(req);if(!validSubscription(data.subscription))throw error('이 브라우저의 알림 수신 주소를 지원하지 않습니다.');
          const settings=sanitizeSettings(data.settings);if(!settings.regions.length)throw error('알림 지역을 선택해 주세요.');
          if(Object.values(store.state.subscriptions).some(s=>s.subscription.endpoint===data.subscription.endpoint))throw error('이 브라우저의 기존 알림 연결을 해제한 뒤 다시 켜 주세요.',409);
          if(Object.keys(store.state.subscriptions).length>=5000)throw error('알림 등록 한도에 도달했습니다.',503);
          const id=randomUUID(),token=randomBytes(32).toString('base64url');
          await store.update(s=>{s.subscriptions[id]={id,tokenHash:hash(token),subscription:{endpoint:data.subscription.endpoint,keys:{p256dh:data.subscription.keys.p256dh,auth:data.subscription.keys.auth}},settings,createdAt:new Date(clock()).toISOString(),lastSentAt:null,lastError:null};});
          return json(res,201,{id,token,settings});
        }
        const route=path.match(/^\/api\/subscriptions\/([\da-f-]{36})(\/test)?$/);
        if(route){
          const sub=authenticate(req,route[1]);
          if(req.method==='GET'&&!route[2])return json(res,200,{settings:sub.settings,lastSentAt:sub.lastSentAt,lastError:sub.lastError});
          if(req.method==='PUT'&&!route[2]){const data=await body(req),settings=sanitizeSettings(data.settings);if(!settings.regions.length)throw error('알림 지역을 선택해 주세요.');if(data.subscription&&(!validSubscription(data.subscription)||Object.values(store.state.subscriptions).some(s=>s.id!==sub.id&&s.subscription.endpoint===data.subscription.endpoint)))throw error('유효하지 않은 알림 연결입니다.');await store.update(s=>{s.subscriptions[sub.id].settings=settings;if(data.subscription)s.subscriptions[sub.id].subscription={endpoint:data.subscription.endpoint,keys:{p256dh:data.subscription.keys.p256dh,auth:data.subscription.keys.auth}};if(!settings.enabled)s.outbox.filter(o=>o.subscriptionId===sub.id&&o.status==='pending').forEach(o=>o.status='cancelled');});return json(res,200,{settings});}
          if(req.method==='DELETE'&&!route[2]){await store.update(s=>{delete s.subscriptions[sub.id];s.outbox=s.outbox.filter(o=>o.subscriptionId!==sub.id);});return json(res,200,{ok:true});}
          if(req.method==='POST'&&route[2]){
            if(sub.testAt&&clock()-Date.parse(sub.testAt)<60000)throw error('테스트 알림은 1분 후 다시 보낼 수 있습니다.',429);
            await store.update(s=>{s.subscriptions[sub.id].testAt=new Date(clock()).toISOString();});
            try{await push(sub.subscription,{id:randomUUID(),title:'슬기로운 이직생활',body:'테스트 알림입니다. 새 공고 알림 연결을 확인했어요.',url:'/?settings=1'});}catch{throw error('알림 서비스에 연결하지 못했습니다. 네트워크와 브라우저 권한을 확인해 주세요.',502);}
            return json(res,200,{ok:true,message:'알림 서비스에 테스트 전송 완료'});
          }
        }
        throw error('요청한 기능을 찾을 수 없습니다.',404);
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw error('지원하지 않는 요청',405);
      const asset=ASSETS.get(path);if(!asset)throw error('페이지를 찾을 수 없습니다.',404);
      const content=await readFile(resolve(ROOT,asset[0]));
      res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-cache',...(path==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})});res.end(req.method==='HEAD'?undefined:content);
    }catch(e){json(res,e.status||500,{error:e.status?e.message:'처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const runner=scheduler?startScheduler(store,push,{interval:Math.max(60,Number(process.env.COLLECT_INTERVAL_MINUTES)||60)*60000,...(collect?{collect}:{}),clock}):null;
  async function close(){await runner?.stop();networkAgent.destroy();await new Promise(r=>server.close(r));await store.tail;await releaseLock?.();}
  return {server,store,runner,close};
}
export async function startServer(){
  const port=Number(process.env.PORT)||4173,host=process.env.HOST||'127.0.0.1';
  const app=await createApp();app.server.listen(port,host,()=>console.log(`슬기로운 이직생활: ${publicOrigin()} · 1시간마다 공고 확인`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await startServer();
