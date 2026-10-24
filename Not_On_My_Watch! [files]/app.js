(function(){
const $=id=>document.getElementById(id);
const vid=$('vid'),cv=$('cv'),ctx=cv.getContext('2d',{willReadFrequently:true});
const W=96,H=72;
let stream=null,detector=null,actx=null,alarmTimer=null;
let S={mode:'idle',study:0,away:0,count:0,rounds:0,cycle:0,absent:0,present:0,brk:0,brkTotal:0,itemMs:0,brkKind:''};
let banned=[]; // {name,hue,tol,sat}
let recent=[]; // presence samples
let last=performance.now();

const fmt=(ms,h)=>{const s=Math.floor(ms/1000),hh=Math.floor(s/3600),mm=Math.floor(s%3600/60),ss=s%60,p=n=>String(n).padStart(2,'0');return h?p(hh)+':'+p(mm)+':'+p(ss):p(mm+hh*60)+':'+p(ss)};
const cfg=()=>({grace:+$('grace').value*1000,longb:+$('longb').value*1000,focus:+$('focus').value*60000});

function beep(freq,dur,vol){try{if(!actx)return;const o=actx.createOscillator(),g=actx.createGain();o.type='square';o.frequency.value=freq;g.gain.value=vol||.15;o.connect(g);g.connect(actx.destination);o.start();o.stop(actx.currentTime+dur)}catch(e){}}
function startAlarm(){stopAlarm();let f=false;const go=()=>{f=!f;beep(f?880:660,.3,.25)};go();alarmTimer=setInterval(go,400)}
function stopAlarm(){if(alarmTimer){clearInterval(alarmTimer);alarmTimer=null}}
function chime(){beep(660,.15,.2);setTimeout(()=>beep(880,.15,.2),180);setTimeout(()=>beep(1175,.3,.2),360)}

function setMode(m){S.mode=m;render()}
function notify(title,body){try{if(window.Notification&&Notification.permission==='granted')new Notification(title,{body,requireInteraction:true,tag:'nomw'})}catch(e){}}
function showAlarm(title,msg,btn){notify(title,msg);$('aTitle').textContent=title;$('aMsg').textContent=msg;$('aBtn').textContent=btn;$('alarm').classList.add('on');startAlarm()}
function hideAlarm(){$('alarm').classList.remove('on');stopAlarm()}

async function startCamera(){
  if(stream)return true;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
    vid.srcObject=stream;await vid.play();$('camhint').hidden=true;
    if('FaceDetector' in window){try{detector=new FaceDetector({fastMode:true,maxDetectedFaces:1})}catch(e){}}
    return true;
  }catch(e){
    $('camhint').hidden=false;
    $('camhint').textContent='Camera blocked or unavailable. Allow camera access in your browser’s site settings, then press Start again.';
    return false;
  }
}

function skinRatio(d){let n=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(r>95&&g>40&&b>20&&mx-mn>15&&Math.abs(r-g)>15&&r>g&&r>b)n++}return n/(d.length/4)}
function hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360}return[h,mx?d/mx:0,mx]}
function hueDist(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d}

async function sample(){
  if(!stream||vid.readyState<2)return null;
  ctx.drawImage(vid,0,0,W,H);
  const img=ctx.getImageData(0,0,W,H).data;
  let present=skinRatio(img)>0.03;
  if(detector){try{const f=await detector.detect(vid);present=f.length>0}catch(e){}}
  let item=null;
  if(banned.length){
    for(const b of banned){
      let n=0;
      for(let i=0;i<img.length;i+=4){const [h,s,v]=hsv(img[i],img[i+1],img[i+2]);if(s>=b.sat&&v>.2&&hueDist(h,b.hue)<=b.tol)n++}
      if(n/(W*H)>0.02){item=b.name;break}
    }
  }
  return {present,item};
}

let polling=false;
async function poll(){
  if(polling)return;polling=true;
  if(S.mode==='studying'||S.mode==='alert'||S.mode==='longbreak'){
    const r=await sample();
    if(r){
      recent.push(r.present);if(recent.length>3)recent.shift();
      S.seen=recent.some(x=>x);S.item=r.item;
    }
  }
  polling=false;
}

function tick(){
  const now=performance.now(),dt=now-last;last=now;const c=cfg();
  if(S.mode==='studying'){
    if(S.item){S.itemMs+=dt}else S.itemMs=0;
    if(S.seen===false){S.absent+=dt;S.away+=dt}else S.absent=0;
    if(S.seen!==false&&S.itemMs<8000){S.study+=dt;S.cycle+=dt}
    if(S.absent>c.grace){S.count++;S.reason='away';setMode('alert');showAlarm('NOT ON MY WATCH!','You left your desk. The clock is stopped. Get back in view.','I’m back')}
    else if(S.itemMs>=8000){S.count++;S.reason='item';setMode('alert');showAlarm('PUT THE '+(S.item||'item').toUpperCase()+' AWAY!','A banned item has been in view for too long. The clock is stopped.','Done, resume')}
    else if(S.cycle>=c.focus){S.rounds++;S.cycle=0;chime();notify('Round complete','Nice work. Take a 5-minute break.');startBreak(5*60000,'round')}
  }else if(S.mode==='alert'){
    if(S.reason==='away'){S.away+=dt;S.absent+=dt;
      if(S.absent>c.longb){hideAlarm();setMode('longbreak')}
      if(S.seen!==false){S.present+=dt}else S.present=0;
      if(S.present>1500){hideAlarm();S.absent=0;S.present=0;setMode('studying')}
    }else{ if(!S.item){hideAlarm();S.itemMs=0;setMode('studying')} }
  }else if(S.mode==='longbreak'){
    S.away+=dt;
    if(S.seen!==false){S.present+=dt;if(S.present>1500){S.absent=0;S.present=0;setMode('studying')}}else S.present=0;
  }else if(S.mode==='break'){
    S.brk-=dt;S.away+=0;
    if(S.brk<=0){chime();notify('Break over','Ready to start the next round?');setMode('ready');}
  }
  render();
}

function startBreak(ms,kind){S.brk=ms;S.brkTotal=ms;S.brkKind=kind;setMode('break')}

function render(){
  const c=cfg(),m=S.mode,st=$('state');
  $('clock').textContent=m==='break'?fmt(Math.max(S.brk,0)):fmt(S.study,true);
  $('away').textContent=fmt(S.away);$('cnt').textContent=S.count;$('rounds').textContent=S.rounds;
  $('cyc').style.width=Math.min(100,S.cycle/c.focus*100)+'%';
  $('cycTxt').textContent='Focus round: '+Math.floor(S.cycle/60000)+' of '+(c.focus/60000)+' min';
  const labels={idle:'Ready when you are',studying:'Studying. Clock is running',alert:'Distracted. Clock stopped',longbreak:'Long break assumed. Clock stopped, return to resume',break:S.brkKind==='round'?'Round complete. Break time':'On a break',paused:'Paused',ready:'Break over. Ready to go again?'};
  st.textContent=labels[m]||'';st.className='state '+(m==='studying'?'studying':m==='alert'?'alert':'');
  const b=$('badge');
  if(!stream){b.textContent='Camera off';b.className='badge'}
  else if(['studying','alert','longbreak'].includes(m)){b.textContent=S.seen===false?'Not in view':(S.item?S.item+' in view':'In view');b.className='badge '+(S.seen===false||S.item?'out':'in')}
  else{b.textContent='Not tracking';b.className='badge'}
  $('startBtn').textContent=m==='idle'?'Start studying':(m==='paused'||m==='ready'?'Resume':'Start studying');
  $('startBtn').disabled=['studying','alert','longbreak','break'].includes(m);
  $('pauseBtn').disabled=m!=='studying';
  $('brkBtn').disabled=!['studying','paused'].includes(m);
  $('endBtn').disabled=m==='idle';
  updatePip();
  document.title=(m==='alert'?'⚠ ':'')+fmt(S.study,true)+' · Not on my watch';
}

/* floating always-on-top mini window (Document Picture-in-Picture, Chrome/Edge 116+) */
let pip=null;
const PIP_CSS='html,body{margin:0;height:100%}body{font-family:system-ui,sans-serif;background:#0d151c;color:#eaf1f6;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:8px;box-sizing:border-box}#pc{font-size:44px;font-weight:800;font-variant-numeric:tabular-nums}#ps{font-size:14px;margin-bottom:4px}body.go{background:#0b3d30}#pb{display:none;margin-top:8px;font-size:15px;padding:8px 16px;font-weight:700;border:0;border-radius:8px;background:#1a1200;color:#ffd400;cursor:pointer}body.alert{color:#1a1200;animation:f .6s steps(1) infinite}body.alert #pb{display:block}@keyframes f{0%{background:#ffd400}50%{background:#ff4b2b}}@media(prefers-reduced-motion:reduce){body.alert{animation:none;background:#ff4b2b;color:#fff}}';
async function openPip(){
  if(pip){pip.close();return}
  if(!('documentPictureInPicture' in window)){alert('Floating window needs Chrome or Edge 116 or newer. Alternatively, put this tab in its own browser window beside your study material.');return}
  try{
    pip=await documentPictureInPicture.requestWindow({width:300,height:170});
    const d=pip.document,st=d.createElement('style');st.textContent=PIP_CSS;d.head.appendChild(st);
    d.body.innerHTML='<div id="ps"></div><div id="pc"></div><button id="pb">I’m back</button>';
    d.getElementById('pb').onclick=()=>{if($('alarm').classList.contains('on'))$('aBtn').click()};
    pip.addEventListener('pagehide',()=>{pip=null;$('pipBtn').textContent='Float timer'});
    $('pipBtn').textContent='Close floating timer';updatePip();
  }catch(e){pip=null}
}
function updatePip(){
  if(!pip)return;
  const d=pip.document,m=S.mode;
  d.body.className=m==='alert'?'alert':m==='studying'?'go':'';
  d.getElementById('ps').textContent=m==='alert'?'NOT ON MY WATCH!':$('state').textContent;
  d.getElementById('pc').textContent=$('clock').textContent;
}
$('pipBtn').onclick=openPip;

$('startBtn').onclick=async()=>{
  try{if(window.Notification&&Notification.permission==='default')Notification.requestPermission()}catch(e){}
  if(!actx){try{actx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}
  if(actx&&actx.state==='suspended')actx.resume();
  if(!(await startCamera()))return;
  S.absent=0;S.present=0;S.itemMs=0;recent=[];S.seen=true;last=performance.now();setMode('studying');
};
$('pauseBtn').onclick=()=>setMode('paused');
$('brkBtn').onclick=()=>{const s=prompt('Break length in minutes (bathroom, snack, stretch)?','10');const n=parseFloat(s);if(n>0)startBreak(n*60000,'manual')};
$('endBtn').onclick=()=>{hideAlarm();setMode('idle');if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;vid.srcObject=null;$('camhint').hidden=false;$('camhint').textContent='Session ended. Total study time: '+fmt(S.study,true)+'.'}};
$('aBtn').onclick=()=>{hideAlarm();S.absent=0;S.present=0;S.itemMs=0;setMode('studying')};

/* banned items */
let regStream=false;
$('regBtn').onclick=async()=>{
  if(!(await startCamera()))return;
  const rc=$('regcam');rc.hidden=false;$('capRow').hidden=false;
  if(!rc.querySelector('video')){const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=true;v.srcObject=stream;v.style.transform='scaleX(-1)';rc.insertBefore(v,rc.firstChild);v.play()}
};
$('capBtn').onclick=()=>{
  const name=$('itemName').value.trim()||'Item';
  ctx.drawImage(vid,0,0,W,H);
  const x0=Math.floor(W*.35),y0=Math.floor(H*.3),w=Math.floor(W*.3),h=Math.floor(H*.4);
  const d=ctx.getImageData(x0,y0,w,h).data;
  const bins=new Array(36).fill(0);let tot=0,rs=0,gs=0,bs=0;
  for(let i=0;i<d.length;i+=4){const [hh,s,v]=hsv(d[i],d[i+1],d[i+2]);if(s>.25&&v>.2){bins[Math.floor(hh/10)%36]++;tot++;rs+=d[i];gs+=d[i+1];bs+=d[i+2]}}
  if(tot<w*h*.15){alert('That area is too grey or dark to match by colour. Try a more colourful item, or fill the dashed box with it.');return}
  let bi=0;bins.forEach((n,i)=>{if(n>bins[bi])bi=i});
  banned.push({name,hue:bi*10+5,tol:18,sat:.25,rgb:`rgb(${Math.round(rs/tot)},${Math.round(gs/tot)},${Math.round(bs/tot)})`});
  $('itemName').value='';listItems();
};
function listItems(){
  const ul=$('items');ul.innerHTML='';
  banned.forEach((b,i)=>{const li=document.createElement('li');li.innerHTML='<span class="sw"></span><span></span><button>Remove</button>';
    li.children[0].style.background=b.rgb;li.children[1].textContent=b.name+' is banned';
    li.children[2].onclick=()=>{banned.splice(i,1);listItems()};ul.appendChild(li)});
}

/* Timers run in a Web Worker so browsers don't throttle them in background tabs */
function ticker(fn,ms){
  try{
    const w=new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},'+ms+')'],{type:'text/javascript'})));
    w.onmessage=fn;return w;
  }catch(e){return setInterval(fn,ms)}
}
ticker(tick,250);ticker(poll,500);render();
})();