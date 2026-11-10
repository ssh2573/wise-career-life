import https from 'node:https';
export const networkAgent=new https.Agent({keepAlive:true,proxyEnv:process.env});
export async function request(url,{method='GET',headers={},body,allowedHosts,timeout=12000,maxBytes=4_000_000,redirects=3}={}) {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||(allowedHosts&&!allowedHosts.includes(target.hostname)))throw new Error('허용하지 않은 외부 주소');
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{method,headers,agent:networkAgent},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();if(!redirects)return reject(new Error('리다이렉트 한도 초과'));return resolve(request(new URL(res.headers.location,target),{method,headers,body,allowedHosts,timeout,maxBytes,redirects:redirects-1}));}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new Error('응답 크기 초과'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    const timer=setTimeout(()=>{const error=new Error('외부 사이트 연결 시간 초과');reject(error);req.destroy(error);},timeout);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
  });
}
