import {createApp} from '../server.mjs';
import {collectJobKorea} from '../lib/collector.mjs';
import {applyCollection} from '../lib/engine.mjs';
const app=await createApp({scheduler:false});
try{const result=await collectJobKorea(app.store.snapshot().feed);await applyCollection(app.store,result);console.log(JSON.stringify({status:result.status,inspected:result.inspected,accepted:result.jobs.length,message:result.message}));if(!result.success)process.exitCode=1;}finally{await app.close();}
