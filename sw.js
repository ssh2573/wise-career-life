// Pages always load fresh data; do not cache a stale job feed.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let message;try{message=event.data?.json();}catch{return;}
  if(!message?.id||!message.title)return;
  event.waitUntil((async()=>{
    const cache=await caches.open('wise-career-delivered-v1');
    const key=new Request(self.location.origin+'/__delivered/'+encodeURIComponent(message.id));
    if(await cache.match(key))return;
    const target=new URL(message.url||'/',self.location.origin);
    await self.registration.showNotification(String(message.title).slice(0,100),{body:String(message.body||'').slice(0,350),tag:message.id,renotify:false,icon:'/icon.svg',data:{url:target.origin===self.location.origin?target.href:self.location.origin}});
    await cache.put(key,new Response('1'));
    const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-500)))await cache.delete(old);
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).origin===url.origin);if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);})());
});
