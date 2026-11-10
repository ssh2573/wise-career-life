import {createECDH,createHmac,createCipheriv,createPrivateKey,sign,randomBytes} from 'node:crypto';
import {request} from './http.mjs';
const b64=b=>Buffer.from(b).toString('base64url');
const from=s=>Buffer.from(s,'base64url');
const mac=(key,input)=>createHmac('sha256',key).update(input).digest();
const expand=(key,info,size)=>mac(key,Buffer.concat([Buffer.from(info),Buffer.from([1])])).subarray(0,size);
export function generateKeys(){const ec=createECDH('prime256v1');ec.generateKeys();return {publicKey:b64(ec.getPublicKey()),privateKey:b64(ec.getPrivateKey())};}
export function validSubscription(value){
  try{
    const u=new URL(value.endpoint),host=u.hostname;
    const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||/^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host)||host==='web.push.apple.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
    if(!allowed||u.protocol!=='https:'||u.port||u.username||u.password||u.hash||u.href.length>2048)return false;
    const key=from(value.keys.p256dh),auth=from(value.keys.auth);
    if(key.length!==65||key[0]!==4||auth.length!==16)return false;
    const ec=createECDH('prime256v1');ec.generateKeys();ec.computeSecret(key);return true;
  }catch{return false;}
}
// RFC 8291 / RFC 8188 aes128gcm, one record. Verified against the RFC Appendix A vector.
export function encryptPayload(subscription,payload,{salt=randomBytes(16),privateKey}={}){
  const plaintext=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  if(plaintext.length>3993)throw new Error('알림 내용이 너무 깁니다');
  const ec=createECDH('prime256v1');if(privateKey)ec.setPrivateKey(privateKey);else ec.generateKeys();
  const publicKey=ec.getPublicKey(),ua=from(subscription.keys.p256dh),auth=from(subscription.keys.auth);
  const secret=ec.computeSecret(ua);
  const ikm=expand(mac(auth,secret),Buffer.concat([Buffer.from('WebPush: info\0'),ua,publicKey]),32);
  const prk=mac(salt,ikm),cek=expand(prk,'Content-Encoding: aes128gcm\0',16),nonce=expand(prk,'Content-Encoding: nonce\0',12);
  const cipher=createCipheriv('aes-128-gcm',cek,nonce);
  const ciphertext=Buffer.concat([cipher.update(Buffer.concat([plaintext,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
  const header=Buffer.alloc(21);salt.copy(header);header.writeUInt32BE(4096,16);header[20]=65;
  return Buffer.concat([header,publicKey,ciphertext]);
}
export function authorization(endpoint,keys,subject,now=Date.now()){
  if(!/^mailto:[^\s@]+@[^\s@]+$|^https:\/\/[^\s]+$/.test(subject))throw new Error('알림 운영 주소가 필요합니다');
  const pub=from(keys.publicKey),key=createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:b64(pub.subarray(1,33)),y:b64(pub.subarray(33,65)),d:keys.privateKey}});
  const token=b64(JSON.stringify({typ:'JWT',alg:'ES256'}))+'.'+b64(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+12*3600,sub:subject}));
  const signature=sign('sha256',Buffer.from(token),{key,dsaEncoding:'ieee-p1363'});
  return `vapid t=${token}.${b64(signature)}, k=${keys.publicKey}`;
}
export async function sendPush(subscription,payload,keys,subject,{transport=request,topic}={}){
  if(!validSubscription(subscription))throw new Error('지원하지 않는 알림 수신 주소');
  const body=encryptPayload(subscription,JSON.stringify(payload));
  const headers={'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','Content-Length':body.length,TTL:'3600',Urgency:'normal',Authorization:authorization(subscription.endpoint,keys,subject)};
  if(topic)headers.Topic=topic;
  const response=await transport(subscription.endpoint,{method:'POST',headers,body,allowedHosts:[new URL(subscription.endpoint).hostname],redirects:0});
  if(response.status<200||response.status>=300){const error=new Error('알림 서비스 응답 '+response.status);error.status=response.status;error.retryAfter=response.headers?.['retry-after'];throw error;}
}
