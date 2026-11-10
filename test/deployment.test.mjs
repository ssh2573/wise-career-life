import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireLock} from '../lib/lock.mjs';
import {publicOrigin} from '../server.mjs';

test('a stale container lock recovers even when the new process reuses its PID',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wise-lock-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'server.lock'),JSON.stringify({pid:process.pid,host:'previous-container',started:'1'}));
  const release=await acquireLock(directory);
  await assert.rejects(acquireLock(directory),/사용 중/);
  await release();
  const releaseAgain=await acquireLock(directory);await releaseAgain();
});
test('Railway public domain is used unless an explicit custom origin is set',()=>{
  assert.equal(publicOrigin({RAILWAY_PUBLIC_DOMAIN:'wise.up.railway.app'}),'https://wise.up.railway.app');
  assert.equal(publicOrigin({PUBLIC_ORIGIN:'https://example.com',RAILWAY_PUBLIC_DOMAIN:'wise.up.railway.app'}),'https://example.com');
  assert.equal(publicOrigin({PORT:'5000'}),'http://127.0.0.1:5000');
});
