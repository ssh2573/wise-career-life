const KEY='wise-career:push-device';
const readDevice=()=>{try{return JSON.parse(localStorage.getItem(KEY));}catch{return null;}};
const writeDevice=value=>{if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY);};
async function api(path,{method='GET',data,device}={}){
  const response=await fetch(path,{method,cache:'no-store',headers:{...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(device?{Authorization:'Bearer '+device.token}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok){const e=new Error(result.error||'연결하지 못했습니다.');e.status=response.status;throw e;}return result;
}
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const time=value=>value?new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(value)):'아직 없음';
export function initLive({applyFeed,getSettings,applySettings,toast,onNavigate}){
  const note=document.querySelector('#draft-note'),status=document.querySelector('#notification-status'),toggle=document.querySelector('#notify-toggle'),save=document.querySelector('#save-settings'),test=document.querySelector('#test-notification');
  let config=null,registration=null,loading=false,busy=false,device=readDevice(),feedSignature='';
  const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  const switchValue=on=>{toggle.classList.toggle('on',on);toggle.setAttribute('aria-checked',String(on));};
  function explain(){
    if(!supported()){status.textContent=/iPad|iPhone/.test(navigator.userAgent)?'Safari에서 홈 화면에 추가한 뒤 알림을 켜 주세요.':'이 브라우저에서는 알림을 지원하지 않습니다. Chrome·Edge·Safari 등에서 열어 주세요.';toggle.disabled=true;test.disabled=true;switchValue(false);return;}
    if(Notification.permission==='denied'){status.textContent='브라우저에서 알림이 차단돼 있습니다. 사이트 설정에서 허용한 뒤 다시 켜 주세요.';switchValue(false);test.disabled=true;return;}
    status.textContent=device?'이 브라우저에 알림이 연결돼 있습니다. 조건을 바꾸면 설정을 저장해 주세요.':'알림을 켜고 설정을 저장하면 새로 발견한 공고부터 알려드려요.';
    test.disabled=!device;
  }
  async function refresh(){
    if(loading)return;loading=true;
    try{
      const feed=await api('/api/feed'),signature=JSON.stringify([feed.jobs,feed.companies]);if(signature!==feedSignature){applyFeed(feed);feedSignature=signature;}
      const source=feed.sources?.[0];
      if(!source)note.textContent='공고 자동 확인 중 · 기존 자료 '+time(feed.checkedAt)+' 확인';
      else if(source.status==='error')note.textContent='최신 공고 확인 지연 · '+(feed.lastSuccessAt?'마지막 성공 ':'저장 자료 확인 ')+time(feed.lastSuccessAt||feed.checkedAt)+' · 기존 자료를 표시합니다.';
      else note.textContent='잡코리아 자동 수집 · '+time(feed.lastSuccessAt)+' 확인 · '+feed.collectionIntervalMinutes+'분마다 확인'+(source.status==='partial'?' · 일부 공고 확인 지연':'')+' · 변경·마감은 원문 확인';
      document.querySelector('#collection-status').textContent=source?.status==='error'?'최근 수집에 실패했습니다. 다음 주기에 다시 확인합니다.':feed.collecting?'서버가 1시간마다 공고를 확인합니다.':'자동 수집 서버가 중지돼 있습니다.';
    }catch{note.textContent='자동 수집 서버에 연결할 수 없습니다. 마지막 저장 자료를 표시합니다.';document.querySelector('#collection-status').textContent='서버 연결을 확인해 주세요.';}
    finally{loading=false;}
  }
  toggle.addEventListener('click',async()=>{
    if(busy||!supported())return;
    const next=toggle.getAttribute('aria-checked')!=='true';
    if(next){
      toggle.disabled=true;status.textContent='브라우저의 알림 허용 요청을 확인해 주세요.';
      let timer;const permission=await Promise.race([Notification.requestPermission(),new Promise(r=>{timer=setTimeout(()=>r('timeout'),15000);})]).catch(()=> 'unavailable');clearTimeout(timer);toggle.disabled=false;
      if(permission!=='granted'){switchValue(false);explain();if(['timeout','unavailable'].includes(permission))status.textContent='알림 권한을 확인하지 못했습니다. 일반 브라우저에서 열어 다시 시도해 주세요.';return;}
    }
    switchValue(next);status.textContent='설정 저장을 누르면 알림 변경이 적용됩니다.';
  });
  save.addEventListener('click',async()=>{
    if(busy)return;busy=true;save.disabled=true;
    try{
      const settings=getSettings();
      if(settings.enabled){
        if(!supported()||Notification.permission!=='granted')throw new Error('먼저 브라우저 알림을 허용해 주세요.');
        config ||= await api('/api/config');
        registration ||= await navigator.serviceWorker.register('/sw.js',{scope:'/'});
        await navigator.serviceWorker.ready;
        let subscription=await registration.pushManager.getSubscription();
        if(subscription&&!device){await subscription.unsubscribe();subscription=null;}
        subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
        if(device){await api('/api/subscriptions/'+device.id,{method:'PUT',device,data:{settings,subscription:subscription.toJSON()}});}
        else{
          const result=await api('/api/subscriptions',{method:'POST',data:{subscription:subscription.toJSON(),settings}});
          device={id:result.id,token:result.token};
          try{writeDevice(device);}catch{await api('/api/subscriptions/'+device.id,{method:'DELETE',device,data:{}});device=null;await subscription.unsubscribe();throw new Error('브라우저 저장 공간을 사용할 수 없어 알림을 연결하지 못했습니다.');}
        }
      }else if(device){
        await api('/api/subscriptions/'+device.id,{method:'DELETE',device,data:{}});
        writeDevice(null);device=null;
        registration ||= await navigator.serviceWorker.getRegistration('/');
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
      }
      localStorage.setItem('safety-radar-draft:settings',JSON.stringify(settings));
      explain();toast(settings.enabled?'새 공고 알림을 연결했어요.':'알림 설정을 저장했어요.');
    }catch(e){status.textContent=e.message;if(e.status===401){writeDevice(null);device=null;}if(!device)switchValue(false);toast('설정을 적용하지 못했어요. 안내를 확인해 주세요.');}
    finally{busy=false;save.disabled=false;test.disabled=!device;}
  });
  test.addEventListener('click',async()=>{
    if(!device||busy)return;busy=true;test.disabled=true;
    try{
      const sent=await api('/api/subscriptions/'+device.id+'/test',{method:'POST',device,data:{}});
      status.textContent='테스트 알림을 보냈습니다. 이 브라우저의 수신을 확인하고 있어요.';
      let receipt;
      for(let i=0;i<20;i++){
        await new Promise(r=>setTimeout(r,1000));
        const data=await api('/api/subscriptions/'+device.id,{device});
        if(data.lastTest?.id===sent.id&&data.lastTest.receivedAt){receipt=data.lastTest;break;}
      }
      status.textContent=receipt?.displayed?'브라우저가 테스트 알림을 받았습니다. 배너가 보이지 않으면 기기의 Chrome 알림 허용과 집중 모드를 확인해 주세요.':receipt?'알림은 도착했지만 표시하지 못했습니다. 브라우저와 기기의 알림 권한을 확인해 주세요.':'브라우저 수신이 아직 확인되지 않았습니다. 네트워크 연결과 기기의 알림 설정을 확인해 주세요.';
      toast(receipt?.displayed?'브라우저 알림 수신을 확인했어요.':'테스트 결과 안내를 확인해 주세요.');
    }catch(e){status.textContent=e.message;toast(e.message);}finally{busy=false;test.disabled=!device;}
  });
  (async()=>{
    explain();await refresh();
    try{
      config=await api('/api/config');
      if(supported())registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
      if(device){const data=await api('/api/subscriptions/'+device.id,{device});const sub=await registration?.pushManager.getSubscription();if(!sub){switchValue(false);status.textContent='브라우저 알림 연결이 끊겼습니다. 끄고 저장한 뒤 다시 켜 주세요.';}else{applySettings(data.settings);explain();if(data.lastError)status.textContent='최근 알림 전송에 실패했습니다. 테스트 알림으로 확인해 주세요.';}}
      else switchValue(false);
    }catch(e){if(e.status===401){writeDevice(null);device=null;switchValue(false);explain();}else status.textContent='알림 서버 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';}
    const params=new URLSearchParams(location.search);onNavigate(params);
  })();
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
