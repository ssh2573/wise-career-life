import {mkdir,chown,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';

// Railway mounts a fresh volume as root. Prepare only the app's private
// directory, then drop privileges before opening the HTTP server.
if(process.getuid?.()===0){
  const directory=resolve(process.env.DATA_DIR||'/app/.runtime');
  await mkdir(directory,{recursive:true,mode:0o700});
  await chown(directory,1000,1000);
  await chmod(directory,0o700);
  process.setgroups([]);process.setgid(1000);process.setuid(1000);
}
const {startServer}=await import('../server.mjs');
await startServer();
