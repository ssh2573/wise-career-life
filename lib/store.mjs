import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
// One process owns this store. Writes are serialized and committed by atomic rename.
export class Store {
  constructor(directory){this.directory=directory;this.tail=Promise.resolve();}
  async init(seed){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    this.file=join(this.directory,'state.json');
    try{this.state=JSON.parse(await readFile(this.file,'utf8'));if(this.state.version!==1)throw new Error('Unsupported state version');}
    catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,feed:{...seed,jobs:seed.jobs.map(j=>({...j,firstSeenAt:seed.checkedAt,lastVerifiedAt:seed.checkedAt})),sources:[],lastAttemptAt:null,lastSuccessAt:null,nextCheckAt:null},subscriptions:{},outbox:[],keys:null,collector:{}};await this.commit();}
    return this;
  }
  async commit(){const temp=this.file+'.tmp';await writeFile(temp,JSON.stringify(this.state),{mode:0o600});await rename(temp,this.file);}
  update(fn){const operation=this.tail.then(async()=>{const previous=structuredClone(this.state);try{const result=await fn(this.state);await this.commit();return result;}catch(e){this.state=previous;throw e;}});this.tail=operation.catch(()=>{});return operation;}
  snapshot(){return structuredClone(this.state);}
}
