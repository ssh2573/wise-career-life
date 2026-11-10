import {collectJobKorea} from './collector.mjs';
import {collectSaramin} from './saramin.mjs';
import {collectOfficial} from './official.mjs';
import {collectAmore} from './amore.mjs';
export const COLLECTOR_VERSION=2;
export async function collectAll(current,options={}){
  const collectors=[['jobkorea','잡코리아',collectJobKorea],['saramin','사람인',collectSaramin],['coupang','쿠팡 공식',collectOfficial],['amore','아모레퍼시픽 공식',collectAmore]];
  // Separate hosts may run concurrently; each source has its own paced request stream.
  return Promise.all(collectors.map(async([id,name,collect])=>{try{return await collect(current,options);}catch(e){return {id,name,jobs:[],profiles:[],success:false,status:'error',failures:1,message:e.message};}}));
}
