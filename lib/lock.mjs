import {open,readFile,unlink} from 'node:fs/promises';
import {hostname} from 'node:os';
import {resolve} from 'node:path';

async function started(pid){
  try {const stat=await readFile(`/proc/${pid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}
  catch{return null;}
}

// The data volume must belong to one machine/container at a time.
// A container restart can reuse a PID, so a PID alone is not a lock identity.
export async function acquireLock(directory){
  const path=resolve(directory,'server.lock');
  const identity={pid:process.pid,host:hostname(),started:await started(process.pid)};
  let handle;
  try{handle=await open(path,'wx',0o600);}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const raw=await readFile(path,'utf8');
    let previous;try{previous=JSON.parse(raw);}catch{throw Error('서버 잠금 파일을 확인해 주세요.');}
    if(typeof previous==='number')previous={pid:previous,host:identity.host};
    let alive=false;
    if(previous.host===identity.host&&Number.isInteger(previous.pid)&&previous.pid>0){
      try{process.kill(previous.pid,0);alive=true;}catch(ex){if(ex.code!=='ESRCH')throw ex;}
      if(alive&&previous.started&&previous.started!==await started(previous.pid))alive=false;
    }
    if(alive)throw Error('같은 데이터 경로를 사용 중인 서버가 있습니다.');
    await unlink(path);
    handle=await open(path,'wx',0o600);
  }
  await handle.writeFile(JSON.stringify(identity));
  return async()=>{await handle.close();await unlink(path).catch(()=>{});};
}
