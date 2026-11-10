import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {generateKeys} from '../lib/push.mjs';
test('HTTP feed, private device settings, origin checks, test-push and cancellation',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wise-api-')),sent=[];
  const origin='http://127.0.0.1:4173';const app=await createApp({directory,origin,scheduler:false,send:async(s,p)=>sent.push(p)});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const port=app.server.address().port;
  function call(path,{method='GET',data,token,originHeader=origin,host='127.0.0.1:4173'}={}){return new Promise((resolve,reject)=>{const encoded=data?JSON.stringify(data):undefined;const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{host,origin:originHeader,'Content-Type':'application/json',...(encoded?{'Content-Length':Buffer.byteLength(encoded)}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body,json:()=>JSON.parse(body)}));});req.on('error',reject);req.end(encoded);});}
  const feed=await call('/api/feed');assert.equal(feed.status,200);assert.ok(feed.json().jobs.length);assert.equal(feed.json().subscriptions,undefined);assert.equal(feed.json().keys,undefined);
  const health=await call('/healthz',{host:'healthcheck.railway.app'});assert.equal(health.status,200);assert.deepEqual(health.json(),{ok:true});
  assert.equal((await call('/api/config',{host:'healthcheck.railway.app'})).status,403);
  assert.equal((await call('/.runtime/state.json')).status,404);assert.equal((await call('/server.mjs')).status,404);assert.equal((await call('/api/config',{host:'evil.test'})).status,403);
  const keys=generateKeys(),subscription={endpoint:'https://fcm.googleapis.com/fcm/send/api-test',keys:{p256dh:keys.publicKey,auth:Buffer.alloc(16,1).toString('base64url')}};
  const settings={enabled:true,regions:['경기'],strict:false};
  assert.equal((await call('/api/subscriptions',{method:'POST',data:{subscription,settings},originHeader:'https://evil.test'})).status,403);
  const created=await call('/api/subscriptions',{method:'POST',data:{subscription,settings}});assert.equal(created.status,201);const {id,token}=created.json();
  assert.equal((await call('/api/subscriptions/'+id)).status,401);assert.equal((await call('/api/subscriptions/'+id,{token:'bad'})).status,401);
  const own=await call('/api/subscriptions/'+id,{token});assert.equal(own.status,200);assert.equal(own.json().tokenHash,undefined);
  assert.equal((await call('/api/subscriptions/'+id+'/test',{method:'POST',token,data:{}})).status,200);assert.equal(sent.length,1);
  assert.equal((await call('/api/subscriptions/'+id+'/test',{method:'POST',token,data:{}})).status,429);
  await call('/api/subscriptions/'+id,{method:'PUT',token,data:{settings:{...settings,regions:['서울'],cadence:'daily'}}});assert.deepEqual(app.store.state.subscriptions[id].settings.regions,['서울']);
  assert.equal((await call('/api/subscriptions/'+id,{method:'DELETE',token,data:{}})).status,200);assert.equal(Object.keys(app.store.state.subscriptions).length,0);
});
