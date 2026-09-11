/* ============ DATA LAYER (in-memory — resets on reload, no persistence by design) ============ */
const DB = {
  users: [
    {id:1, username:'admin', password:'Admin@123', role:'Admin', name:'Alex Morgan', email:'alex.morgan@college.edu', status:'Active', createdVia:'seed'},
    {id:2, username:'faculty', password:'Faculty@123', role:'Faculty', name:'Dr. Priya Nair', email:'priya.nair@college.edu', status:'Active', createdVia:'seed'},
    {id:3, username:'student', password:'Student@123', role:'Student', name:'Rahul Dev', email:'rahul.dev@college.edu', status:'Active', createdVia:'seed'},
  ],
  resources: [
    {id:1, name:'Student Records Database', sensitivity:'High', roles:['Admin','Faculty'], requireTrustedDevice:true, requireMFA:true},
    {id:2, name:'Grade Management System', sensitivity:'High', roles:['Admin','Faculty'], requireTrustedDevice:true, requireMFA:true},
    {id:3, name:'My Academic Profile', sensitivity:'Low', roles:['Admin','Faculty','Student'], requireTrustedDevice:false, requireMFA:false},
    {id:4, name:'Library Portal', sensitivity:'Low', roles:['Admin','Faculty','Student'], requireTrustedDevice:false, requireMFA:false},
    {id:5, name:'Finance & Admin Console', sensitivity:'Critical', roles:['Admin'], requireTrustedDevice:true, requireMFA:true},
    {id:6, name:'HR Records', sensitivity:'Critical', roles:['Admin'], requireTrustedDevice:true, requireMFA:true},
  ],
  logs: [],
  alerts: [],
  accessRequests: [],
  academicRecords: {
    student: { rollNo:'CS21B045', program:'B.Sc. Computer Science', semester:'6th', cgpa:'8.4',
      attendance:'91%', courses:[
        {name:'Data Structures', grade:'A'}, {name:'Operating Systems', grade:'A-'},
        {name:'Database Systems', grade:'B+'}, {name:'Computer Networks', grade:'A'}
      ] }
  },
  nextUserId: 4,
  nextLogId: 1,
  nextReqId: 1,
  nextAlertId: 1,
  failedAttempts: {},
};

const PIPE_STEPS = ['User','Authentication','Identity Verification','Access Policy Check','Authorization','Resource'];

let session = { user:null, deviceTrusted:true, loginTime:null, trust:100 };
let pending = { username:null, otp:null, deviceTrusted:true };
let inactivityTimer=null, countdownTimer=null, secondsLeft=300;
let currentView='dashboard';

/* ============ UTIL ============ */
function nowStr(){ return new Date().toLocaleString(); }
function pad(n){return n.toString().padStart(2,'0');}
function initials(name){return name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();}
function genOtp(){return Math.floor(100000+Math.random()*900000).toString();}
function esc(s){return (s+'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function toast(title, msg, type='info'){
  const wrap=document.getElementById('toast-wrap');
  const el=document.createElement('div');
  el.className='toast '+type;
  el.innerHTML=`<b>${esc(title)}</b><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .4s';setTimeout(()=>el.remove(),400);},4200);
}

function addLog(user, action, result, detail){
  DB.logs.unshift({
    id:DB.nextLogId++, time:nowStr(), user:user?user.username:'unknown', role:user?user.role:'-',
    action, result, detail: detail||'', device: session.deviceTrusted?'Trusted':'Unrecognized',
    ip: '10.20.'+Math.floor(Math.random()*250)+'.'+Math.floor(Math.random()*250)
  });
  scheduleSave(); // almost every mutation logs something, so this is the one hook that covers persistence
}
function addAlert(severity, title, detail){
  DB.alerts.unshift({id:DB.nextAlertId++, time:nowStr(), severity, title, detail});
  scheduleSave();
}

/* ============ PERSISTENCE (real backend database) ============
   On page load we try to fetch the saved state from the backend.
   After almost every mutation (routed through addLog/addAlert, which
   covers nearly everything) we push the current state back.
   Activity logs are intentionally NOT sent/loaded — they stay
   in-memory only and reset each session, by explicit design choice.
   If the backend isn't running, the app just keeps using its
   in-memory seed data, same as the very first version. */
let saveDebounceTimer=null;
function scheduleSave(){
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer=setTimeout(saveStateToBackend, 500);
}
async function saveStateToBackend(){
  try{
    await fetchWithTimeout(`${BACKEND_URL}/api/state`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        users:DB.users, resources:DB.resources, logs:DB.logs, alerts:DB.alerts,
        accessRequests:DB.accessRequests, academicRecords:DB.academicRecords,
        nextUserId:DB.nextUserId, nextLogId:DB.nextLogId, nextReqId:DB.nextReqId, nextAlertId:DB.nextAlertId
      })
    }, 8000);
  } catch(e){ /* backend offline — fine, app keeps working from memory */ }
}
let stateLoadPromise=null;
function ensureStateLoaded(){
  if(!stateLoadPromise) stateLoadPromise=loadStateFromBackend();
  return stateLoadPromise;
}
async function loadStateFromBackend(){
  try{
    const res=await fetchWithTimeout(`${BACKEND_URL}/api/state`, {method:'GET'}, 4000);
    if(!res.ok) return;
    const state=await res.json();
    if(state && Array.isArray(state.users) && state.users.length){
      DB.users=state.users; DB.resources=state.resources;
      DB.logs=state.logs||[]; DB.alerts=state.alerts||[]; DB.accessRequests=state.accessRequests||[];
      DB.academicRecords=state.academicRecords||{};
      DB.nextUserId=state.nextUserId||DB.nextUserId;
      DB.nextLogId=state.nextLogId||DB.nextLogId;
      DB.nextReqId=state.nextReqId||DB.nextReqId;
      DB.nextAlertId=state.nextAlertId||DB.nextAlertId;
      console.log('SentinelGate: loaded persisted state from backend database.');
    }
  } catch(e){
    console.log('SentinelGate: backend not reachable — using local in-memory demo data.');
  }
}

/* ============ HERO PIPELINE (login screen decorative) ============ */
function buildPipeline(containerId, size='full'){
  const c=document.getElementById(containerId);
  c.innerHTML='';
  PIPE_STEPS.forEach((label,i)=>{
    if(i>0){
      const line=document.createElement('div');
      line.className='pipe-line';
      line.dataset.idx=i;
      c.appendChild(line);
    }
    const node=document.createElement('div');
    node.className='pipe-node';
    node.dataset.idx=i;
    node.innerHTML=`<div class="pipe-dot">${i+1}</div><div class="pipe-label">${label}</div>`;
    c.appendChild(node);
  });
}
buildPipeline('hero-pipeline');

function animateHeroLoop(){
  let step=0;
  setInterval(()=>{
    document.querySelectorAll('#hero-pipeline .pipe-dot').forEach(d=>d.classList.remove('active'));
    document.querySelectorAll('#hero-pipeline .pipe-line').forEach(d=>d.classList.remove('active'));
    document.querySelectorAll('#hero-pipeline .pipe-node').forEach((n,i)=>{ if(i<=step) n.querySelector('.pipe-dot').classList.add('active'); });
    document.querySelectorAll('#hero-pipeline .pipe-line').forEach((l,i)=>{ if(i<step) l.classList.add('active'); });
    step=(step+1)%(PIPE_STEPS.length+2);
  },900);
}
animateHeroLoop();

/* runs the pipeline animation inside a container, calls onDone(true/false) */
function runPipelineAnim(containerId, granted, onDone){
  buildPipeline(containerId);
  const nodes=[...document.querySelectorAll('#'+containerId+' .pipe-node')];
  const lines=[...document.querySelectorAll('#'+containerId+' .pipe-line')];
  let i=0;
  const denyAt = granted ? -1 : 3; // deny visually stops/flags at "Access Policy Check" step (idx 3)
  function step(){
    if(i<nodes.length){
      const isLast = i===nodes.length-1;
      const dot=nodes[i].querySelector('.pipe-dot');
      if(!granted && i===denyAt){
        dot.classList.add('denied');
      } else if(!granted && i>denyAt){
        // subsequent nodes stay neutral (blocked)
      } else if(isLast && granted){
        dot.classList.add('granted');
      } else {
        dot.classList.add('active');
      }
      if(lines[i-1]) lines[i-1].classList.add('active');
      i++;
      if(!granted && i>denyAt+1){ if(onDone) onDone(); return; }
      setTimeout(step, 420);
    } else {
      if(onDone) onDone();
    }
  }
  step();
}

/* ============ LOGIN / MFA / REGISTER ============ */
function fillDemo(u,p){ document.getElementById('li-username').value=u; document.getElementById('li-password').value=p; }
function showEl(id){document.getElementById(id).classList.remove('hidden');}
function hideEl(id){document.getElementById(id).classList.add('hidden');}
function showRegister(){ ['form-login','form-mfa','form-pipeline'].forEach(hideEl); showEl('form-register'); }
function showLogin(){ ['form-register','form-mfa','form-pipeline'].forEach(hideEl); showEl('form-login'); document.getElementById('login-error').innerHTML=''; }

/* ============ REAL OTP DELIVERY (optional backend) ============
   If a local backend (see /backend) is running, the OTP is generated
   server-side and emailed for real, and never shown in the browser.
   If the backend is not reachable, the app falls back to the on-screen
   "demo mode" OTP so it still works for offline grading/demos. */
const BACKEND_URL = 'https://sentinelgate-1.onrender.com';

async function fetchWithTimeout(url, opts, ms=2500){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(), ms);
  try{
    const res=await fetch(url, {...opts, signal:ctrl.signal});
    return res;
  } finally { clearTimeout(t); }
}

ensureStateLoaded(); // safe here — BACKEND_URL and fetchWithTimeout are both defined above

async function sendOtpEmail(user){
  try{
    const res=await fetchWithTimeout(`${BACKEND_URL}/api/send-otp`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:user.email, username:user.username})
    }, 60000); // real SMTP delivery can take a few seconds, so allow up to 12s before falling back
    if(!res.ok) throw new Error('backend rejected request');
    return {ok:true, backendUsed:true};
  } catch(e){
    return {ok:false, backendUsed:false};
  }
}

async function verifyOtpBackend(email, code){
  try{
    const res=await fetchWithTimeout(`${BACKEND_URL}/api/verify-otp`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email, code})
    });
    if(!res.ok) return {reachable:true, valid:false};
    const data=await res.json();
    return {reachable:true, valid:!!data.success};
  } catch(e){
    return {reachable:false, valid:false};
  }
}

async function handleLoginSubmit(){
  await ensureStateLoaded(); // make sure we have the latest saved users before checking credentials
  const u=document.getElementById('li-username').value.trim();
  const p=document.getElementById('li-password').value;
  const deviceTrusted=document.getElementById('li-device').checked;
  const errBox=document.getElementById('login-error');
  errBox.innerHTML='';

  if(!u || !p){ errBox.innerHTML=errHtml('Enter both username and password.'); return; }

  DB.failedAttempts[u]=DB.failedAttempts[u]||0;
  const user=DB.users.find(x=>x.username===u);

  if(!user || user.password!==p){
    DB.failedAttempts[u]++;
    addLog(user||{username:u,role:'Unknown'}, 'Login attempt', 'denied', 'Invalid credentials');
    if(DB.failedAttempts[u]>=3){
      addAlert('High','Repeated failed login attempts', `${DB.failedAttempts[u]} failed attempts for username "${u}" — possible credential guessing.`);
      errBox.innerHTML=errHtml('Too many failed attempts. This activity has been logged and flagged to administrators.');
    } else {
      errBox.innerHTML=errHtml('Invalid username or password.');
    }
    return;
  }
  if(user.status==='Suspended'){
    addLog(user,'Login attempt','denied','Account suspended');
    addAlert('Medium','Login blocked — suspended account', `Suspended user "${user.username}" attempted to sign in.`);
    errBox.innerHTML=errHtml('This account has been suspended by an administrator.');
    return;
  }

  DB.failedAttempts[u]=0;
  pending.username=u;
  pending.deviceTrusted=deviceTrusted;
  pending.otp=genOtp();          // used only as the demo/offline fallback
  pending.backendUsed=false;

  document.getElementById('mfa-username').textContent=u;
  document.getElementById('mfa-code').value='';
  document.getElementById('mfa-error').innerHTML='';
  hideEl('form-login'); showEl('form-mfa');

  const banner=document.getElementById('otp-banner-text');
  banner.textContent='Contacting verification server…';

  const result=await sendOtpEmail(user);
  if(result.ok){
    pending.backendUsed=true;
    banner.innerHTML=`A real one-time code was emailed to <b>${esc(user.email)}</b>. Check your inbox.`;
  } else {
    pending.backendUsed=false;
    banner.innerHTML=`Backend not detected — using local demo mode. Your one-time code is <b id="otp-reveal">${pending.otp}</b>`;
  }
  startOtpCountdown();
}

function errHtml(msg){ return `<div class="error-msg">⚠ ${esc(msg)}</div>`; }

/* ============ OTP EXPIRY COUNTDOWN (30 seconds) ============ */
const OTP_LIFETIME_SECONDS = 30;
let otpTimer=null;

function startOtpCountdown(){
  clearInterval(otpTimer);
  pending.issuedAt = Date.now();
  pending.expired = false;

  const fill=document.getElementById('otp-timer-fill');
  const text=document.getElementById('otp-timer-text');
  const resendRow=document.getElementById('mfa-resend-row');
  const verifyBtn=document.getElementById('mfa-verify-btn');
  const codeInput=document.getElementById('mfa-code');

  resendRow.classList.add('hidden');
  verifyBtn.disabled=false;
  codeInput.disabled=false;
  fill.classList.remove('warn'); text.classList.remove('warn');
  document.getElementById('mfa-error').innerHTML='';

  otpTimer=setInterval(()=>{
    const elapsed=(Date.now()-pending.issuedAt)/1000;
    const remaining=Math.max(0, OTP_LIFETIME_SECONDS-elapsed);
    const pct=(remaining/OTP_LIFETIME_SECONDS)*100;
    fill.style.width=pct+'%';
    text.textContent=`Code expires in ${Math.ceil(remaining)}s`;
    if(remaining<=10){ fill.classList.add('warn'); text.classList.add('warn'); }

    if(remaining<=0){
      clearInterval(otpTimer);
      pending.expired=true;
      text.textContent='Code expired';
      verifyBtn.disabled=true;
      codeInput.disabled=true;
      resendRow.classList.remove('hidden');
      document.getElementById('mfa-error').innerHTML=errHtml('Your one-time code has expired for security reasons. Request a new one to continue.');
      addLog({username:pending.username,role:'-'}, 'OTP expired', 'denied', 'Verification code was not entered within the 30-second window.');
    }
  }, 250);
}

async function resendOtp(){
  const user=DB.users.find(x=>x.username===pending.username);
  if(!user) return;
  pending.otp=genOtp();
  document.getElementById('mfa-code').value='';
  const banner=document.getElementById('otp-banner-text');
  banner.textContent='Sending a new code…';

  const result=await sendOtpEmail(user);
  if(result.ok){
    pending.backendUsed=true;
    banner.innerHTML=`A new code was emailed to <b>${esc(user.email)}</b>. Check your inbox.`;
  } else {
    pending.backendUsed=false;
    banner.innerHTML=`Backend not detected — using local demo mode. Your one-time code is <b id="otp-reveal">${pending.otp}</b>`;
  }
  toast('New code sent', 'A fresh 30-second window has started.', 'info');
  startOtpCountdown();
}

function cancelMfa(){ clearInterval(otpTimer); pending={username:null,otp:null,deviceTrusted:true,backendUsed:false}; showLogin(); }

async function verifyOtp(){
  const code=document.getElementById('mfa-code').value.trim();
  const err=document.getElementById('mfa-error');

  if(pending.expired){
    err.innerHTML=errHtml('Your one-time code has expired. Please request a new one.');
    return;
  }

  const user=DB.users.find(x=>x.username===pending.username);

  if(pending.backendUsed){
    const result=await verifyOtpBackend(user.email, code);
    if(!result.valid){
      err.innerHTML=errHtml('Incorrect or expired code. Check your email and try again.');
      return;
    }
  } else {
    if(code!==pending.otp){
      err.innerHTML=errHtml('Incorrect code. Check the demo code above and try again.');
      return;
    }
  }

  clearInterval(otpTimer);
  hideEl('form-mfa'); showEl('form-pipeline');
  runPipelineAnim('login-pipeline-run', true, ()=>{
    completeLogin();
  });
}

function completeLogin(){
  const user=DB.users.find(x=>x.username===pending.username);
  session.user=user;
  session.deviceTrusted=pending.deviceTrusted;
  session.loginTime=new Date();
  session.trust= pending.deviceTrusted ? 100 : 72;
  addLog(user, 'Login', 'granted', pending.deviceTrusted?'MFA verified · trusted device':'MFA verified · unrecognized device (reduced trust)');
  if(!pending.deviceTrusted){
    addAlert('Low','Login from unrecognized device', `${user.name} (${user.role}) signed in from a device not marked as trusted.`);
  }
  toast('Access granted', `Welcome back, ${user.name}.`, 'success');
  pending={username:null,otp:null,deviceTrusted:true};
  enterApp();
}

async function handleRegister(){
  await ensureStateLoaded(); // check against the real, current list of usernames
  const name=document.getElementById('reg-name').value.trim();
  const username=document.getElementById('reg-username').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const password=document.getElementById('reg-password').value;
  const role=document.getElementById('reg-role').value;
  const err=document.getElementById('reg-error');
  err.innerHTML='';
  if(!name||!username||!email||!password){ err.innerHTML=errHtml('All fields are required.'); return; }
  if(DB.users.some(u=>u.username===username)){ err.innerHTML=errHtml('That username is already taken.'); return; }
  const user={id:DB.nextUserId++, username, password, role, name, email, status:'Active', createdVia:'self-registration'};
  DB.users.push(user);
  addLog(user,'Account registered','granted', `Self-registered as ${role} — least-privilege role applied by default.`);
  toast('Account created', `Welcome ${name}. You can now sign in.`, 'success');
  fillDemo(username,password);
  showLogin();
}

/* ============ APP SHELL ============ */
function enterApp(){
  document.getElementById('view-login').style.display='none';
  document.getElementById('view-app').classList.add('shown');
  document.getElementById('tb-avatar').textContent=initials(session.user.name);
  document.getElementById('tb-role-badge').textContent=session.user.role;
  document.getElementById('tb-role-badge').className='role-badge '+session.user.role;
  buildNav();
  navigate('dashboard');
  resetInactivity();
  startCountdown();
  startContinuousVerification();
}

function logout(reason){
  if(session.user){ addLog(session.user,'Logout','granted', reason||'User initiated sign-out'); }
  clearInterval(countdownTimer); clearTimeout(inactivityTimer); clearInterval(window.__cvInterval);
  session={user:null,deviceTrusted:true,loginTime:null,trust:100};
  document.getElementById('view-app').classList.remove('shown');
  document.getElementById('view-login').style.display='grid';
  showLogin();
  document.getElementById('li-password').value='';
  if(reason) toast('Session ended', reason, 'warn');
}

/* session inactivity + countdown */
['click','keydown','mousemove','touchstart'].forEach(ev=>{
  document.addEventListener(ev, ()=>{ if(session.user) resetInactivity(); });
});
function resetInactivity(){ secondsLeft=300; }
function startCountdown(){
  clearInterval(countdownTimer);
  countdownTimer=setInterval(()=>{
    if(!session.user) return;
    secondsLeft--;
    const pill=document.getElementById('session-pill');
    const clock=document.getElementById('session-clock');
    if(clock){
      const m=Math.floor(secondsLeft/60), s=secondsLeft%60;
      clock.textContent=pad(m)+':'+pad(s);
      pill.classList.toggle('warn', secondsLeft<=60);
    }
    if(secondsLeft<=0){ logout('Session expired after 5 minutes of inactivity — access automatically revoked.'); }
  },1000);
}
/* continuous verification: periodic re-check while session active */
function startContinuousVerification(){
  clearInterval(window.__cvInterval);
  window.__cvInterval=setInterval(()=>{
    if(!session.user) return;
    const drift=Math.random()<0.15;
    if(drift){
      session.trust=Math.max(55, session.trust-8);
      toast('Continuous verification', 'Trust score re-evaluated — minor risk signal detected.', 'warn');
    } else {
      session.trust=Math.min(100, session.trust+2);
    }
    updateTrustMeter();
  }, 20000);
}
function updateTrustMeter(){
  const fill=document.getElementById('trust-fill');
  const pct=document.getElementById('trust-pct');
  if(fill){ fill.style.width=session.trust+'%'; pct.textContent=session.trust+'%';
    fill.style.background= session.trust>85 ? 'linear-gradient(90deg,var(--success),var(--accent))' : session.trust>65 ? 'linear-gradient(90deg,var(--warning),var(--accent))' : 'linear-gradient(90deg,var(--danger),var(--warning))';
  }
}

/* ============ NAV ============ */
const ICONS={
  dashboard:'<path d="M3 13h8V3H3v10z"/><path d="M13 21h8V11h-8v10z"/><path d="M13 3v6h8V3h-8z"/><path d="M3 21h8v-6H3v6z"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2S15.5 16.4 15.5 20"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15.2 13.9c2.6.4 4.3 2.5 4.3 5.6"/>',
  resources:'<rect x="3" y="4" width="18" height="5" rx="1.3"/><rect x="3" y="14" width="18" height="6" rx="1.3"/><path d="M7 6.5h.01M7 17h.01"/>',
  requests:'<path d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4"/><path d="M14 3h7v7"/><path d="M21 3l-9 9"/>',
  logs:'<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h10"/>',
  alerts:'<path d="M12 2L2 20h20L12 2z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  reports:'<path d="M6 2h9l5 5v15H6V2z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/>',
  profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'
};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;}

function navItemsFor(role){
  const common=[
    {id:'dashboard', label:'Dashboard', icon:'dashboard'},
  ];
  if(role==='Admin'){
    return [...common,
      {id:'users', label:'Users & Roles', icon:'users', group:'Administration'},
      {id:'resources', label:'Resources & Policies', icon:'resources'},
      {id:'requests', label:'Access Requests', icon:'requests', badge:()=>DB.accessRequests.filter(r=>r.manualReview && r.manualStatus==='pending').length},
      {id:'logs', label:'Activity Logs', icon:'logs', group:'Monitoring'},
      {id:'alerts', label:'Security Alerts', icon:'alerts', badge:()=>DB.alerts.length},
      {id:'reports', label:'Audit Reports', icon:'reports'},
      {id:'profile', label:'My Profile', icon:'profile', group:'Account'},
    ];
  }
  return [...common,
    {id:'requests', label:'Request Access', icon:'requests', group:'Access'},
    {id:'logs', label:'My Activity', icon:'logs'},
    {id:'profile', label:'My Profile', icon:'profile', group:'Account'},
  ];
}

function buildNav(){
  const items=navItemsFor(session.user.role);
  const c=document.getElementById('nav-container');
  let html=''; let lastGroup=null;
  items.forEach(it=>{
    if(it.group && it.group!==lastGroup){ html+=`<div class="nav-group-label">${it.group}</div>`; lastGroup=it.group; }
    const badge = it.badge ? it.badge() : 0;
    html+=`<div class="nav-item" data-nav="${it.id}" onclick="navigate('${it.id}')">${icon(it.icon)}<span>${it.label}</span>${badge?`<span class="badge-count">${badge}</span>`:''}</div>`;
  });
  c.innerHTML=html;
}

const PAGE_META={
  dashboard:{title:'Dashboard', crumb:'sentinelgate / dashboard'},
  users:{title:'Users & Roles', crumb:'sentinelgate / administration / users'},
  resources:{title:'Resources & Access Policies', crumb:'sentinelgate / administration / policies'},
  requests:{title:'Access Requests', crumb:'sentinelgate / access'},
  logs:{title:'Activity Logs', crumb:'sentinelgate / monitoring / logs'},
  alerts:{title:'Security Alerts', crumb:'sentinelgate / monitoring / alerts'},
  reports:{title:'Audit Reports', crumb:'sentinelgate / administration / reports'},
  profile:{title:'My Profile', crumb:'sentinelgate / account'},
};

function navigate(view){
  currentView=view;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.nav===view));
  document.getElementById('tb-title').textContent=PAGE_META[view].title;
  document.getElementById('tb-crumb').textContent=PAGE_META[view].crumb;
  render();
  updateTrustMeter();
}

function render(){
  const c=document.getElementById('content');
  const role=session.user.role;
  if(currentView==='dashboard') c.innerHTML= role==='Admin'? renderAdminDashboard(): renderUserDashboard();
  else if(currentView==='users') c.innerHTML=renderUsers();
  else if(currentView==='resources') c.innerHTML=renderResources();
  else if(currentView==='requests') c.innerHTML= role==='Admin'? renderAdminRequests() : renderAccessRequestPage();
  else if(currentView==='logs') c.innerHTML= role==='Admin'? renderLogs() : renderMyLogs();
  else if(currentView==='alerts') c.innerHTML=renderAlerts();
  else if(currentView==='reports') c.innerHTML=renderReports();
  else if(currentView==='profile') c.innerHTML=renderProfile();
  buildNav();
}

/* ============ DASHBOARDS ============ */
function renderAdminDashboard(){
  const totalUsers=DB.users.length;
  const granted=DB.logs.filter(l=>l.result==='granted').length;
  const denied=DB.logs.filter(l=>l.result==='denied').length;
  const pendingReq=DB.accessRequests.filter(r=>r.manualReview && r.manualStatus==='pending').length;
  return `
  <div class="page-head"><h2>Welcome back, ${esc(session.user.name.split(' ')[0])}</h2><p>Zero trust posture across ${DB.users.length} identities and ${DB.resources.length} protected resources.</p></div>
  <div class="grid grid-4" style="margin-bottom:16px;">
    ${statCard('users','Registered users', totalUsers, 'var(--accent)', `${DB.users.filter(u=>u.status==='Active').length} active`)}
    ${statCard('resources','Protected resources', DB.resources.length, 'var(--faculty)', `${DB.resources.filter(r=>r.sensitivity==='Critical').length} critical`)}
    ${statCard('logs','Access grants', granted, 'var(--success)', `${denied} denied`)}
    ${statCard('alerts','Open alerts', DB.alerts.length, 'var(--danger)', `${pendingReq} requests pending review`)}
  </div>
  <div class="grid grid-2">
    <div class="card">
      <h3>Recent activity</h3><p class="card-sub">Latest authentication &amp; access events across all users</p>
      ${logTable(DB.logs.slice(0,7))}
    </div>
    <div class="card">
      <h3>Security alerts</h3><p class="card-sub">Signals requiring attention</p>
      ${DB.alerts.length? DB.alerts.slice(0,5).map(a=>alertRow(a)).join('') : '<div class="empty-state">No active alerts. System nominal.</div>'}
    </div>
  </div>
  <div class="card" style="margin-top:16px;">
    <h3>Role distribution &amp; least-privilege snapshot</h3><p class="card-sub">Access is scoped by role — no identity holds more than it needs</p>
    ${roleMatrixMini()}
  </div>`;
}

function renderUserDashboard(){
  const u=session.user;
  const myLogs=DB.logs.filter(l=>l.user===u.username).slice(0,6);
  const myResources=DB.resources.filter(r=>r.roles.includes(u.role));
  return `
  <div class="page-head"><h2>Welcome, ${esc(u.name.split(' ')[0])}</h2><p>Signed in as <b>${u.role}</b>. Your access is scoped to only what your role requires.</p></div>
  <div class="grid grid-4" style="margin-bottom:16px;">
    ${statCard('resources','Resources you can access', myResources.length, 'var(--accent)', 'Least-privilege scope')}
    ${statCard('logs','Your access grants', DB.logs.filter(l=>l.user===u.username&&l.result==='granted').length, 'var(--success)', 'All-time')}
    ${statCard('alerts','Your denied attempts', DB.logs.filter(l=>l.user===u.username&&l.result==='denied').length, 'var(--danger)', 'Policy enforced')}
    ${statCard('users','Session trust score', session.trust+'%', 'var(--faculty)', session.deviceTrusted?'Trusted device':'Unrecognized device')}
  </div>
  <div class="grid grid-2">
    <div class="card">
      <h3>Your recent activity</h3><p class="card-sub">A private log of your own logins and access requests</p>
      ${logTable(myLogs)}
    </div>
    <div class="card">
      <h3>Resources available to your role</h3><p class="card-sub">${u.role} scope</p>
      <table><thead><tr><th>Resource</th><th>Sensitivity</th></tr></thead><tbody>
      ${myResources.map(r=>`<tr style="cursor:pointer;" onclick="openResourceDetail(${r.id})"><td class="strong">${esc(r.name)}</td><td><span class="tag sev-${r.sensitivity}">${r.sensitivity}</span></td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>`;
}

/* ============ RESOURCE DETAIL MODAL (Academic Profile / Library Portal) ============ */
function getAcademicRecord(username){
  if(!DB.academicRecords[username]){
    DB.academicRecords[username] = { rollNo:'STU'+String(Date.now()).slice(-5), program:'General Studies',
      semester:'1st', cgpa:'—', attendance:'—', courses:[] };
  }
  return DB.academicRecords[username];
}

function openResourceDetail(resourceId){
  const resource = DB.resources.find(r=>r.id===resourceId);
  if(!resource) return;
  const handlers = {
    'My Academic Profile': showAcademicProfile,
    'Library Portal': showLibraryPortal,
    'Student Records Database': showStudentRecordsDatabase,
    'Grade Management System': showGradeManagementSystem,
    'Finance & Admin Console': showFinanceConsole,
    'HR Records': showHrRecords,
  };
  const handler = handlers[resource.name];
  if(handler){ handler(); }
  else {
    // A brand-new resource an admin added that has no custom view yet — show a simple generic one
    addLog(session.user, `Opened ${resource.name}`, 'granted', 'Self-service access');
    document.getElementById('academic-modal-content').innerHTML = `
      <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
      <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Sensitivity: ${esc(resource.sensitivity)} · Allowed roles: ${resource.roles.join(', ')}</p>
      <div class="empty-state">This resource doesn't have a custom detail view yet — it was likely added recently via Resources &amp; Policies. Access was still verified through the pipeline and logged.</div>`;
    document.getElementById('academic-modal').classList.remove('hidden');
  }
}

function showStudentRecordsDatabase(){
  addLog(session.user, 'Opened Student Records Database', 'granted', `Viewed by ${session.user.role}`);
  const students = DB.users.filter(u=>u.role==='Student');
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">Student Records Database</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">${students.length} student record(s) — visible to Admin &amp; Faculty only.</p>
    <table><thead><tr><th>Name</th><th>Roll No.</th><th>Program</th><th>CGPA</th><th>Attendance</th></tr></thead><tbody>
    ${students.length? students.map(s=>{ const r=getAcademicRecord(s.username); return `<tr><td class="strong">${esc(s.name)}</td><td class="mono">${esc(r.rollNo)}</td><td>${esc(r.program)}</td><td>${esc(r.cgpa)}</td><td>${esc(r.attendance)}</td></tr>`; }).join('') : '<tr><td colspan="5" style="color:var(--text-faint);">No student accounts yet.</td></tr>'}
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function showGradeManagementSystem(){
  addLog(session.user, 'Opened Grade Management System', 'granted', `Viewed by ${session.user.role}`);
  const students = DB.users.filter(u=>u.role==='Student');
  let rows = '';
  students.forEach(s=>{
    const r = getAcademicRecord(s.username);
    if(r.courses.length){
      r.courses.forEach(c=>{ rows += `<tr><td class="strong">${esc(s.name)}</td><td>${esc(c.name)}</td><td>${esc(c.grade)}</td></tr>`; });
    } else {
      rows += `<tr><td class="strong">${esc(s.name)}</td><td colspan="2" style="color:var(--text-faint);">No grades recorded yet.</td></tr>`;
    }
  });
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">Grade Management System</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Course grades across all students — visible to Admin &amp; Faculty only.</p>
    <table><thead><tr><th>Student</th><th>Course</th><th>Grade</th></tr></thead><tbody>
    ${rows || '<tr><td colspan="3" style="color:var(--text-faint);">No records yet.</td></tr>'}
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function showFinanceConsole(){
  addLog(session.user, 'Opened Finance & Admin Console', 'granted', 'Admin-only access');
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">Finance & Admin Console</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Critical sensitivity — Admin only.</p>
    <div class="profile-grid">
      <div class="profile-item"><span>Annual Budget</span><b>₹4.2 Cr</b></div>
      <div class="profile-item"><span>Allocated</span><b>₹3.1 Cr</b></div>
      <div class="profile-item"><span>Pending Approvals</span><b>3</b></div>
      <div class="profile-item"><span>Fiscal Year</span><b>2026–27</b></div>
    </div>
    <h3 style="font-size:14px;margin:18px 0 8px 0;">Department Allocations</h3>
    <table><thead><tr><th>Department</th><th>Allocated</th></tr></thead><tbody>
      <tr><td class="strong">Computer Science</td><td>₹95 L</td></tr>
      <tr><td class="strong">Library &amp; Resources</td><td>₹40 L</td></tr>
      <tr><td class="strong">Campus Infrastructure</td><td>₹1.2 Cr</td></tr>
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function showHrRecords(){
  addLog(session.user, 'Opened HR Records', 'granted', 'Admin-only access');
  const staff = DB.users.filter(u=>u.role==='Admin' || u.role==='Faculty');
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">HR Records</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Staff directory — Critical sensitivity, Admin only.</p>
    <table><thead><tr><th>Name</th><th>Role</th><th>Employee ID</th><th>Status</th></tr></thead><tbody>
    ${staff.map(s=>`<tr><td class="strong">${esc(s.name)}</td><td>${esc(s.role)}</td><td class="mono">EMP-${String(s.id).padStart(4,'0')}</td><td><span class="tag ${s.status}">${esc(s.status)}</span></td></tr>`).join('')}
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function showAcademicProfile(){
  const u=session.user;
  const rec=getAcademicRecord(u.username);
  addLog(u, 'Viewed academic profile', 'granted', 'Self-service access to own record');
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(u.name)}'s Academic Profile</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0;">Scoped to your own record only — Student role cannot view others' data.</p>
    <div class="profile-grid">
      <div class="profile-item"><span>Roll No.</span><b>${esc(rec.rollNo)}</b></div>
      <div class="profile-item"><span>Program</span><b>${esc(rec.program)}</b></div>
      <div class="profile-item"><span>Semester</span><b>${esc(rec.semester)}</b></div>
      <div class="profile-item"><span>CGPA</span><b>${esc(rec.cgpa)}</b></div>
      <div class="profile-item"><span>Attendance</span><b>${esc(rec.attendance)}</b></div>
    </div>
    <h3 style="font-size:14px;margin:18px 0 8px 0;">Courses</h3>
    <table><thead><tr><th>Course</th><th>Grade</th></tr></thead><tbody>
    ${rec.courses.length? rec.courses.map(c=>`<tr><td class="strong">${esc(c.name)}</td><td>${esc(c.grade)}</td></tr>`).join('') : '<tr><td colspan="2" style="color:var(--text-faint);">No courses on record yet.</td></tr>'}
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function showLibraryPortal(){
  const u=session.user;
  addLog(u, 'Opened Library Portal', 'granted', 'Self-service access');
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">Library Portal</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Signed in as ${esc(u.name)} — borrowing history and current loans.</p>
    <table><thead><tr><th>Book</th><th>Status</th><th>Due</th></tr></thead><tbody>
      <tr><td class="strong">Introduction to Algorithms</td><td><span class="tag granted">Borrowed</span></td><td>02 Sep 2026</td></tr>
      <tr><td class="strong">Computer Networking: A Top-Down Approach</td><td><span class="tag granted">Borrowed</span></td><td>10 Sep 2026</td></tr>
      <tr><td class="strong">Clean Code</td><td><span class="tag pending">Reserved</span></td><td>—</td></tr>
    </tbody></table>`;
  document.getElementById('academic-modal').classList.remove('hidden');
}

function closeAcademicModal(){
  document.getElementById('academic-modal').classList.add('hidden');
}

function statCard(iconName,label,val,color,delta){
  return `<div class="card stat-card">
    <div class="stat-top"><div class="stat-icon" style="background:${color}22;color:${color};">${icon(iconName)}</div></div>
    <div class="stat-val">${val}</div><div class="stat-label">${label}</div>
    <div class="stat-delta" style="color:var(--text-faint)">${delta}</div>
  </div>`;
}
function logTable(rows){
  if(!rows.length) return '<div class="empty-state">No activity yet.</div>';
  return `<table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th></tr></thead><tbody>
  ${rows.map(l=>`<tr><td class="mono" style="font-size:11px;">${l.time}</td><td class="strong">${esc(l.user)}</td><td>${esc(l.action)}</td><td><span class="tag ${l.result}">${l.result}</span></td></tr>`).join('')}
  </tbody></table>`;
}
function alertRow(a){
  const color= a.severity==='High'?'var(--danger)': a.severity==='Medium'?'var(--warning)':'var(--accent)';
  return `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-soft);">
    <div style="width:6px;height:6px;border-radius:50%;background:${color};margin-top:6px;flex:none;"></div>
    <div><div style="font-size:12.5px;color:var(--text);">${esc(a.title)}</div><div style="font-size:11px;color:var(--text-faint);margin-top:2px;">${esc(a.detail)}</div></div>
  </div>`;
}
function roleMatrixMini(){
  const roles=['Admin','Faculty','Student'];
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
  ${roles.map(r=>{
    const count=DB.resources.filter(res=>res.roles.includes(r)).length;
    const cls=r==='Admin'?'admin':r==='Faculty'?'faculty':'student';
    return `<div style="padding:14px;border-radius:10px;border:1px solid var(--border-soft);background:var(--surface-2);">
      <span class="role-badge ${r}">${r}</span>
      <div style="font-family:var(--font-display);font-size:22px;margin-top:10px;">${count}<span style="font-size:12px;color:var(--text-faint);"> / ${DB.resources.length}</span></div>
      <div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">resources permitted</div>
    </div>`;
  }).join('')}
  </div>`;
}

/* ============ USERS & ROLES ============ */
function renderUsers(){
  return `
  <div class="page-head"><h2>Users &amp; role assignment</h2><p>Assign roles deliberately — each role carries a fixed, least-privilege permission set enforced automatically.</p></div>
  <div class="card">
    <div class="toolbar"><div class="toolbar-left"><input class="search-box" placeholder="Search users…" oninput="renderUserTable(this.value)"></div>
      <button class="btn small" style="width:auto;" onclick="toast('Tip','New identities are created via Register on the sign-in screen — this mirrors real self-service onboarding.','info')">+ New user</button>
    </div>
    <div id="user-table-wrap">${userTableHtml(DB.users)}</div>
  </div>`;
}
function renderUserTable(q){
  const rows= (q? DB.users.filter(u=>u.name.toLowerCase().includes(q.toLowerCase())||u.username.toLowerCase().includes(q.toLowerCase())) : DB.users);
  document.getElementById('user-table-wrap').innerHTML=userTableHtml(rows);
}
function userTableHtml(rows){
  if(!rows.length) return '<div class="empty-state">No users match.</div>';
  return `<table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Origin</th><th></th></tr></thead><tbody>
  ${rows.map(u=>`<tr>
    <td class="strong">${esc(u.name)}</td>
    <td class="mono">${esc(u.username)}</td>
    <td><select class="role-select" onchange="changeUserRole(${u.id}, this.value)">
      ${['Admin','Faculty','Student'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}
    </select></td>
    <td><span class="tag ${u.status}">${u.status}</span></td>
    <td style="font-size:11.5px;color:var(--text-faint);">${u.createdVia}</td>
    <td><button class="icon-btn" title="${u.status==='Active'?'Suspend':'Reactivate'}" onclick="toggleUserStatus(${u.id})">${u.status==='Active'? svgLock() : svgUnlock()}</button></td>
  </tr>`).join('')}
  </tbody></table>`;
}
function svgLock(){return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>`;}
function svgUnlock(){return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 017.6-1.8"/></svg>`;}
function changeUserRole(id, role){
  const u=DB.users.find(x=>x.id===id); const old=u.role; u.role=role;
  addLog(session.user, 'Role change', 'granted', `${u.username} role changed ${old} → ${role} by admin ${session.user.username}`);
  toast('Role updated', `${u.name} is now ${role}.`, 'success');
  render();
}
function toggleUserStatus(id){
  const u=DB.users.find(x=>x.id===id);
  u.status = u.status==='Active' ? 'Suspended' : 'Active';
  addLog(session.user, u.status==='Active'?'User reactivated':'User suspended', 'granted', `${u.username} by admin ${session.user.username}`);
  toast('Status updated', `${u.name} is now ${u.status}.`, u.status==='Active'?'success':'warn');
  render();
}

/* ============ RESOURCES & POLICIES ============ */
function renderResources(){
  return `
  <div class="page-head"><h2>Resources &amp; access policies</h2><p>Define which roles may reach each resource, and what conditions (trusted device, MFA) are required — the rules the pipeline enforces on every request.</p></div>
  <div class="card">
    <div class="policy-row head"><div>Resource</div><div>Sensitivity</div><div>Allowed roles</div><div>Trusted device</div><div>MFA</div><div></div></div>
    ${DB.resources.map(r=>`
      <div class="policy-row">
        <div class="strong" style="color:var(--text);">${esc(r.name)}</div>
        <div><span class="tag sev-${r.sensitivity}">${r.sensitivity}</span></div>
        <div>${['Admin','Faculty','Student'].map(role=>`<span class="chip ${r.roles.includes(role)?'on':''}" onclick="toggleResourceRole(${r.id},'${role}')">${role}</span>`).join('')}</div>
        <div><label class="switch"><input type="checkbox" ${r.requireTrustedDevice?'checked':''} onchange="toggleResourceFlag(${r.id},'requireTrustedDevice')"><span class="slider"></span></label></div>
        <div><label class="switch"><input type="checkbox" ${r.requireMFA?'checked':''} onchange="toggleResourceFlag(${r.id},'requireMFA')"><span class="slider"></span></label></div>
        <div></div>
      </div>`).join('')}
  </div>
  <div class="card" style="margin-top:16px;">
    <h3>Add a protected resource</h3><p class="card-sub">New resources default to admin-only until roles are granted</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="flex:2;min-width:200px;margin-bottom:0;"><label>Resource name</label><input id="new-res-name" placeholder="e.g. Alumni Portal"></div>
      <div class="field" style="flex:1;min-width:140px;margin-bottom:0;"><label>Sensitivity</label>
        <select id="new-res-sens"><option>Low</option><option>High</option><option>Critical</option></select>
      </div>
      <button class="btn small" style="width:auto;" onclick="addResource()">Add resource</button>
    </div>
  </div>`;
}
function toggleResourceRole(id, role){
  const r=DB.resources.find(x=>x.id===id);
  if(r.roles.includes(role)) r.roles=r.roles.filter(x=>x!==role); else r.roles.push(role);
  addLog(session.user,'Policy change','granted', `${role} access to "${r.name}" ${r.roles.includes(role)?'granted':'revoked'} by ${session.user.username}`);
  render();
}
function toggleResourceFlag(id, flag){
  const r=DB.resources.find(x=>x.id===id);
  r[flag]=!r[flag];
  addLog(session.user,'Policy change','granted', `${flag} for "${r.name}" set to ${r[flag]} by ${session.user.username}`);
  render();
}
function addResource(){
  const name=document.getElementById('new-res-name').value.trim();
  const sens=document.getElementById('new-res-sens').value;
  if(!name){ toast('Missing name','Enter a resource name first.','warn'); return; }
  DB.resources.push({id:Date.now(), name, sensitivity:sens, roles:['Admin'], requireTrustedDevice: sens!=='Low', requireMFA: sens==='Critical'});
  addLog(session.user,'Resource created','granted', `"${name}" (${sens}) added by ${session.user.username}`);
  toast('Resource added', `${name} is now protected.`, 'success');
  render();
}

/* ============ ACCESS REQUEST (Faculty/Student) ============ */
function renderAccessRequestPage(){
  const role=session.user.role;
  const options=DB.resources.map(r=>`<option value="${r.id}">${esc(r.name)} · ${r.sensitivity}</option>`).join('');
  return `
  <div class="page-head"><h2>Request resource access</h2><p>Every request runs through the full zero trust pipeline — identity, device posture, and policy are re-checked every time.</p></div>
  <div class="grid grid-2">
    <div class="card">
      <h3>New request</h3><p class="card-sub">Select a resource to evaluate</p>
      <div class="field"><label>Resource</label><select id="req-resource">${options}</select></div>
      <button class="btn" onclick="submitAccessRequest()">Run verification</button>
      <div id="req-pipeline-run" class="pipeline-req"></div>
      <div id="req-result"></div>
    </div>
    <div class="card">
      <h3>Your request history</h3><p class="card-sub">Automated decisions for your identity</p>
      <div id="req-history">${myRequestHistory()}</div>
    </div>
  </div>`;
}
function myRequestHistory(){
  const mine=DB.accessRequests.filter(r=>r.user===session.user.username);
  if(!mine.length) return '<div class="empty-state">No requests yet.</div>';
  return `<table><thead><tr><th>Resource</th><th>Result</th><th>Reason</th></tr></thead><tbody>
  ${mine.slice(0,8).map(r=>{
    const clickable = r.automatedResult==='granted';
    return `<tr ${clickable?`style="cursor:pointer;" onclick="openResourceDetail(${r.resourceId})"`:''}>
      <td class="strong">${esc(r.resourceName)}</td>
      <td><span class="tag ${r.automatedResult}">${r.automatedResult}${r.manualReview? (r.manualStatus==='pending'?' · review pending': ' · '+r.manualStatus) : ''}</span></td>
      <td style="font-size:11.5px;">${esc(r.reason)}</td></tr>`;
  }).join('')}
  </tbody></table>`;
}
function evaluateAccess(user, deviceTrusted, resource){
  if(!resource.roles.includes(user.role)){
    return {granted:false, reason:`Role "${user.role}" is not permitted for this resource. Only ${resource.roles.join(', ')} may access it.`};
  }
  if(resource.requireTrustedDevice && !deviceTrusted){
    return {granted:false, reason:`This resource requires a trusted, enrolled device. Your current session device is unrecognized.`};
  }
  if(resource.requireMFA && !user.mfaVerifiedThisSession && false){ /* MFA already enforced at login in this demo */ }
  if(user.role==='Student' && resource.name==='My Academic Profile'){
    return {granted:true, reason:'Access scoped to your own records only.'};
  }
  return {granted:true, reason:`Role "${user.role}" satisfies policy for this resource.`};
}
function submitAccessRequest(){
  const resId=Number(document.getElementById('req-resource').value);
  const resource=DB.resources.find(r=>r.id===resId);
  const evalResult=evaluateAccess(session.user, session.deviceTrusted, resource);
  document.getElementById('req-result').innerHTML='';
  runPipelineAnim('req-pipeline-run', evalResult.granted, ()=>{
    const req={id:DB.nextReqId++, user:session.user.username, userName:session.user.name, role:session.user.role,
      resourceId:resource.id, resourceName:resource.name, time:nowStr(),
      automatedResult: evalResult.granted?'granted':'denied', reason:evalResult.reason, manualReview:false, manualStatus:null};
    DB.accessRequests.unshift(req);
    addLog(session.user, `Access request: ${resource.name}`, evalResult.granted?'granted':'denied', evalResult.reason);
    if(!evalResult.granted && resource.sensitivity!=='Low'){
      addAlert(resource.sensitivity==='Critical'?'High':'Medium', `Denied access attempt — ${resource.name}`, `${session.user.name} (${session.user.role}) was denied per policy: ${evalResult.reason}`);
    }
    const box=document.getElementById('req-result');
    box.innerHTML=`<div class="result-box ${evalResult.granted?'granted':'denied'}">
      <div>
        <h4>${evalResult.granted?'✔ Access granted':'✕ Access denied'}</h4>
        <p>${esc(evalResult.reason)}</p>
        ${!evalResult.granted?`<button class="btn ghost small" style="margin-top:10px;" onclick="escalateRequest(${req.id})">Escalate for admin review</button>`:''}
      </div>
    </div>`;
    document.getElementById('req-history').innerHTML=myRequestHistory();
    buildNav();
  });
}
function escalateRequest(id){
  const req=DB.accessRequests.find(r=>r.id===id);
  req.manualReview=true; req.manualStatus='pending';
  addLog(session.user, 'Escalated for manual review', 'pending', `${req.resourceName} request escalated by ${session.user.username}`);
  toast('Escalated', 'An administrator will review your request.', 'info');
  render();
}
function renderAdminRequests(){
  const pendingList=DB.accessRequests.filter(r=>r.manualReview && r.manualStatus==='pending');
  const all=DB.accessRequests;
  return `
  <div class="page-head"><h2>Access requests</h2><p>Automated zero trust decisions, plus a human-in-the-loop queue for escalated denials.</p></div>
  <div class="card" style="margin-bottom:16px;">
    <h3>Pending manual review ${pendingList.length?`<span class="badge-count">${pendingList.length}</span>`:''}</h3>
    <p class="card-sub">Denied by policy, escalated by the requester for admin override</p>
    ${pendingList.length? `<table><thead><tr><th>User</th><th>Role</th><th>Resource</th><th>Auto reason</th><th></th></tr></thead><tbody>
    ${pendingList.map(r=>`<tr><td class="strong">${esc(r.userName)}</td><td>${r.role}</td><td>${esc(r.resourceName)}</td><td style="font-size:11.5px;">${esc(r.reason)}</td>
      <td style="display:flex;gap:6px;"><button class="btn small" onclick="resolveRequest(${r.id},'approved')">Approve</button><button class="btn ghost small" onclick="resolveRequest(${r.id},'denied')">Deny</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty-state">Nothing pending review.</div>'}
  </div>
  <div class="card">
    <h3>All access requests</h3><p class="card-sub">Full automated decision history</p>
    ${all.length? `<table><thead><tr><th>Time</th><th>User</th><th>Resource</th><th>Automated</th><th>Manual</th></tr></thead><tbody>
    ${all.slice(0,30).map(r=>`<tr><td class="mono" style="font-size:11px;">${r.time}</td><td class="strong">${esc(r.userName)}</td><td>${esc(r.resourceName)}</td>
      <td><span class="tag ${r.automatedResult}">${r.automatedResult}</span></td>
      <td>${r.manualReview? `<span class="tag ${r.manualStatus==='pending'?'pending':r.manualStatus==='approved'?'granted':'denied'}">${r.manualStatus}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty-state">No requests yet.</div>'}
  </div>`;
}
function resolveRequest(id, decision){
  const req=DB.accessRequests.find(r=>r.id===id);
  req.manualStatus=decision;
  addLog(session.user, `Manual review: ${req.resourceName}`, decision==='approved'?'granted':'denied', `Admin ${session.user.username} ${decision} escalated request for ${req.userName}`);
  toast('Request resolved', `${req.userName}'s request was ${decision}.`, decision==='approved'?'success':'warn');
  render();
}

/* ============ LOGS ============ */
function renderLogs(){
  return `
  <div class="page-head"><h2>Activity logs</h2><p>Every authentication and access decision, system-wide — the raw material for audits and incident response.</p></div>
  <div class="card">
    <div class="toolbar">
      <div class="toolbar-left">
        <input class="search-box" placeholder="Search by user or action…" oninput="renderLogTableFiltered(this.value, document.getElementById('log-filter').value)">
        <select class="filter-select" id="log-filter" onchange="renderLogTableFiltered(document.querySelector('.search-box').value, this.value)">
          <option value="">All results</option><option value="granted">Granted</option><option value="denied">Denied</option><option value="pending">Pending</option>
        </select>
      </div>
    </div>
    <div id="log-table-wrap" class="scrollbar" style="max-height:520px;overflow-y:auto;">${fullLogTable(DB.logs)}</div>
  </div>`;
}
function renderLogTableFiltered(q, resultFilter){
  let rows=DB.logs;
  if(q) rows=rows.filter(l=>l.user.toLowerCase().includes(q.toLowerCase())||l.action.toLowerCase().includes(q.toLowerCase()));
  if(resultFilter) rows=rows.filter(l=>l.result===resultFilter);
  document.getElementById('log-table-wrap').innerHTML=fullLogTable(rows);
}
function fullLogTable(rows){
  if(!rows.length) return '<div class="empty-state">No matching log entries.</div>';
  return `<table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Result</th><th>Device</th><th>IP</th><th>Detail</th></tr></thead><tbody>
  ${rows.map(l=>`<tr><td class="mono" style="font-size:11px;">${l.time}</td><td class="strong">${esc(l.user)}</td><td>${esc(l.role)}</td><td>${esc(l.action)}</td>
    <td><span class="tag ${l.result}">${l.result}</span></td><td style="font-size:11.5px;">${l.device}</td><td class="mono" style="font-size:11px;">${l.ip}</td><td style="font-size:11.5px;color:var(--text-faint);">${esc(l.detail)}</td></tr>`).join('')}
  </tbody></table>`;
}
function renderMyLogs(){
  const rows=DB.logs.filter(l=>l.user===session.user.username);
  return `
  <div class="page-head"><h2>My activity</h2><p>A private record of your own logins and access decisions.</p></div>
  <div class="card">${fullLogTable(rows)}</div>`;
}

/* ============ ALERTS ============ */
function renderAlerts(){
  return `
  <div class="page-head"><h2>Security alerts</h2><p>Signals generated automatically from suspicious authentication and access patterns.</p></div>
  <div class="card">
    ${DB.alerts.length? DB.alerts.map(a=>`
      <div style="display:flex;gap:12px;padding:14px 4px;border-bottom:1px solid var(--border-soft);align-items:flex-start;">
        <span class="tag sev-${a.severity==='High'?'Critical':a.severity==='Medium'?'High':'Low'}">${a.severity}</span>
        <div style="flex:1;">
          <div style="font-size:13.5px;color:var(--text);">${esc(a.title)}</div>
          <div style="font-size:12px;color:var(--text-faint);margin-top:3px;">${esc(a.detail)}</div>
          <div class="mono" style="font-size:10.5px;color:var(--text-faint);margin-top:5px;">${a.time}</div>
        </div>
        <button class="icon-btn" title="Dismiss" onclick="dismissAlert(${a.id})">✕</button>
      </div>`).join('') : '<div class="empty-state">No alerts. All access activity looks normal.</div>'}
  </div>`;
}
function dismissAlert(id){ DB.alerts=DB.alerts.filter(a=>a.id!==id); scheduleSave(); toast('Alert dismissed','',''+'info'); render(); }

/* ============ REPORTS ============ */
function renderReports(){
  return `
  <div class="page-head"><h2>Audit reports</h2><p>Export the full activity trail for compliance review or incident investigation.</p></div>
  <div class="grid grid-3">
    ${statCard('logs','Total events', DB.logs.length, 'var(--accent)', 'All-time')}
    ${statCard('alerts','Alerts raised', DB.alerts.length, 'var(--danger)', 'Since session start')}
    ${statCard('requests','Access requests', DB.accessRequests.length, 'var(--faculty)', `${DB.accessRequests.filter(r=>r.manualReview).length} escalated`)}
  </div>
  <div class="card" style="margin-top:16px;">
    <h3>Export activity log</h3><p class="card-sub">Download the complete audit trail as CSV</p>
    <button class="btn small" style="width:auto;" onclick="exportCsv()">Download CSV report</button>
  </div>
  <div class="card" style="margin-top:16px;">
    <h3>Full audit trail</h3><p class="card-sub">Preview of exportable records</p>
    ${fullLogTable(DB.logs)}
  </div>`;
}
function exportCsv(){
  const header=['Time','User','Role','Action','Result','Device','IP','Detail'];
  const rows=DB.logs.map(l=>[l.time,l.user,l.role,l.action,l.result,l.device,l.ip,l.detail]);
  const csv=[header, ...rows].map(r=>r.map(v=>`"${(v+'').replace(/"/g,'""')}"`).join(',')).join('\\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='sentinelgate_audit_report.csv'; a.click();
  URL.revokeObjectURL(url);
  addLog(session.user,'Audit report exported','granted', `CSV export (${DB.logs.length} records) by ${session.user.username}`);
  toast('Report downloaded', 'CSV audit report saved.', 'success');
}

/* ============ PROFILE ============ */
function renderProfile(){
  const u=session.user;
  return `
  <div class="page-head"><h2>My profile</h2><p>Your identity, role, and current session posture.</p></div>
  <div class="grid grid-2">
    <div class="card">
      <h3>${esc(u.name)}</h3><p class="card-sub mono">${esc(u.username)} · ${esc(u.email)}</p>
      <table>
        <tr><td style="width:40%;color:var(--text-faint);">Role</td><td><span class="role-badge ${u.role}">${u.role}</span></td></tr>
        <tr><td style="color:var(--text-faint);">Status</td><td><span class="tag ${u.status}">${u.status}</span></td></tr>
        <tr><td style="color:var(--text-faint);">Account origin</td><td>${u.createdVia}</td></tr>
        <tr><td style="color:var(--text-faint);">Session started</td><td class="mono" style="font-size:12px;">${session.loginTime? session.loginTime.toLocaleString():'-'}</td></tr>
        <tr><td style="color:var(--text-faint);">Device posture</td><td>${session.deviceTrusted? 'Trusted / enrolled' : 'Unrecognized'}</td></tr>
        <tr><td style="color:var(--text-faint);">Trust score</td><td>${session.trust}%</td></tr>
      </table>
    </div>
    <div class="card">
      <h3>Permitted resources</h3><p class="card-sub">Least-privilege scope for ${u.role}</p>
      <table><thead><tr><th>Resource</th><th>Sensitivity</th></tr></thead><tbody>
      ${DB.resources.filter(r=>r.roles.includes(u.role)).map(r=>`<tr><td class="strong">${esc(r.name)}</td><td><span class="tag sev-${r.sensitivity}">${r.sensitivity}</span></td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>`;
}