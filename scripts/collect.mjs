import {createApp} from '../server.mjs';
import {collectAll} from '../lib/sources.mjs';
import {applyCollection} from '../lib/engine.mjs';
const app=await createApp({scheduler:false});
try{const results=await collectAll(app.store.snapshot().feed);for(const result of results){await applyCollection(app.store,result);console.log(JSON.stringify({source:result.name,status:result.status,inspected:result.inspected,accepted:result.jobs.length,message:result.message}));}if(!results.some(r=>r.success))process.exitCode=1;}finally{await app.close();}
