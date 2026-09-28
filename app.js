import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const p=s.split("-").map(Number);return new Date(p[0],p[1]-1,p[2]);};
const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};
const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
const todayISO=()=>iso(today());
const onOrAfter=(d,wd)=>addDays(d,(wd-d.getDay()+7)%7);
const fLong=s=>parse(s).toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const fShort=s=>parse(s).toLocaleDateString("nl-BE",{day:"numeric",month:"short"});
const fShortY=s=>parse(s).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"});
const fTime=t=>new Date(t).toLocaleString("nl-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const WD=["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];
const KIND={vast:"Vaste activiteit",extra:"Extra activiteit",weekend:"Weekend",kamp:"Kamp"};
const ST={aanwezig:{g:"✓",l:"Aanwezig"},afgemeld:{g:"✉",l:"Afgemeld"},afwezig:{g:"✕",l:"Afwezig zonder bericht"}};
const collator=new Intl.Collator("nl",{sensitivity:"base"});
function lsGet(k,d){try{const v=localStorage.getItem("smaf:"+k);return v==null?d:JSON.parse(v);}catch(e){return d;}}
function lsSet(k,v){try{if(v==null)localStorage.removeItem("smaf:"+k);else localStorage.setItem("smaf:"+k,JSON.stringify(v));}catch(e){}}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),2800);}
function deepMerge(a,b){const o=Object.assign({},a);for(const k in b){if(b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k])&&o[k]&&typeof o[k]==="object")o[k]=deepMerge(o[k],b[k]);else o[k]=b[k];}return o;}
const normCode=s=>String(s||"").trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"");

/* ---------- firebase ---------- */
const CFG=window.FIREBASE_CONFIG||{};
const configured=CFG.apiKey&&CFG.projectId&&String(CFG.apiKey).indexOf("VUL")<0;
let fs=null, auth=null, B="";
if(configured){
  const app=initializeApp(CFG);
  auth=getAuth(app);
  fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
}
const dref=p=>doc(fs,B+p);
const cref=c=>collection(fs,B+c);
const newId=c=>doc(cref(c)).id;
function onWriteErr(e){
  console.error(e);
  if(e&&e.code==="permission-denied") toast("Opslaan geweigerd. Klopt de leidingscode nog?");
  else toast("Opslaan mislukt. Probeer het opnieuw.");
}
/* merge-write: creates the document if needed, deep-merges maps. Not awaited: works offline, syncs later. */
function save(p,data){ setDoc(dref(p),data,{merge:true}).catch(onWriteErr); }
function remove(p){ deleteDoc(dref(p)).catch(onWriteErr); }

/* ---------- state ---------- */
const S={code:lsGet("code",null),me:lsGet("naam",""),phase:"boot",loginMsg:"",
  loaded:{takken:false,leden:false,acts:false},
  takken:{},leden:{},acts:{},unsubs:[],unActs:null,
  view:lsGet("view","att"),takId:lsGet("tak",null),curKey:null,
  form:null,confirm:null,openNote:{},openHist:null,showCode:false,
  ovPeriod:lsGet("ovPeriod","scoutsjaar"),ovAnchor:todayISO(),
  drafts:{},busy:false};
const draft=(id,def)=>S.drafts[id]!==undefined?S.drafts[id]:(def==null?"":def);
const dis=()=>"";

/* ---------- data access ---------- */
const takList=()=>Object.values(S.takken).sort((a,b)=>(a.order||0)-(b.order||0)||collator.compare(a.name||"",b.name||""));
const curTak=()=>S.takken[S.takId]||null;
const ledenVan=(takId,inclInactive)=>Object.values(S.leden).filter(l=>l.takId===takId&&(inclInactive||l.active!==false)).sort((a,b)=>collator.compare(a.name,b.name));
const rkey=(takId,date)=>"r_"+takId+"_"+date;

function timeline(from,to){
  const tak=curTak(); if(!tak) return [];
  const wd=tak.weekday==null?6:tak.weekday;
  const map={};
  for(let d=onOrAfter(parse(from),wd);iso(d)<=to;d=addDays(d,7)){const k=rkey(tak.id,iso(d));map[k]={key:k,date:iso(d),kind:"vast"};}
  Object.values(S.acts).forEach(a=>{
    if(!a.date||a.date<from||a.date>to) return;
    if(a.kind==="vast"){ if(!map[a.id]){ const r=a.records||{}; if(Object.keys(r).length||a.note) map[a.id]={key:a.id,date:a.date,kind:"vast"}; } }
    else map[a.id]={key:a.id,date:a.date,kind:a.kind};
  });
  const order={vast:0,extra:1,weekend:2,kamp:3};
  return Object.values(map).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:order[a.kind]-order[b.kind]);
}
function navTimeline(){const t=today();return timeline(iso(addDays(t,-800)),iso(addDays(t,430)));}
function pickDefault(tl){const t=todayISO();return (tl.find(i=>i.date>=t)||tl[tl.length-1]||{}).key||null;}
function patchAct(key,base,patch){ save("act/"+key,deepMerge(base,patch)); }
function baseFor(item){return {takId:S.takId,date:item.date,kind:"vast"};}

/* ---------- render ---------- */
function render(){
  const a=document.activeElement, fid=a&&a.id, ss=a&&a.selectionStart, se=a&&a.selectionEnd;
  renderHeader();
  const inApp=S.phase==="app";
  $("#nav").hidden=!inApp;
  ["att","ov","set"].forEach(v=>{$("#v-"+v).hidden=!inApp||S.view!==v;});
  $("#v-login").hidden=inApp;
  document.querySelectorAll(".bottom button").forEach(b=>{if(b.dataset.v===S.view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  if(!inApp){ renderLogin(); }
  else if(!S.loaded.takken||!S.loaded.leden){ $("#v-"+S.view).innerHTML='<div class="card empty">Gegevens laden…</div>'; }
  else if(S.view==="att") renderAtt(); else if(S.view==="ov") renderOv(); else renderSet();
  if(fid){const b=document.getElementById(fid); if(b&&b!==document.activeElement){ b.focus({preventScroll:true}); try{b.setSelectionRange(ss,se);}catch(e){} }}
}
function renderHeader(){
  const t=curTak(), list=S.phase==="app"?takList():[];
  $("#subtitle").textContent=S.phase!=="app"?"Voor de leiding":t?(t.name+" · "+cap(WD[t.weekday==null?6:t.weekday])+"en"):(S.loaded.takken?"Nog geen tak":"Laden…");
  $("#takBar").innerHTML=list.length>1?list.map(k=>'<button class="chip" data-act="tak" data-id="'+esc(k.id)+'" aria-pressed="'+(k.id===S.takId)+'">'+esc(k.name)+'</button>').join(""):"";
  $("#takBar").hidden=list.length<2;
  const bn=$("#banner");
  if(S.phase==="app"&&!navigator.onLine){bn.hidden=false;bn.textContent="Je bent offline. Wat je invult wordt bewaard en doorgestuurd zodra je weer internet hebt.";}
  else bn.hidden=true;
}

function renderLogin(){
  const el=$("#v-login"); let h='';
  if(S.phase==="noconfig"){
    el.innerHTML='<div class="card"><span class="eyebrow">Nog niet ingesteld</span><h2>Firebase ontbreekt</h2><p class="hint">Vul eerst het bestand <b>config.js</b> in met de gegevens van jullie Firebase-project. Kijk in de handleiding (README) bij stap 3.</p></div>';
    return;
  }
  if(S.phase==="boot"){ el.innerHTML='<div class="card empty">Verbinden…</div>'; return; }
  h+='<div class="card"><span class="eyebrow">Welkom leiding</span><h2>Aanmelden</h2><p class="hint">Vul de leidingscode in die je van de rest van de leiding kreeg. Je naam wordt getoond bij wat jij invult.</p>';
  h+='<div><label class="lbl" for="lg_code">Leidingscode</label><input type="text" id="lg_code" autocomplete="off" autocapitalize="none" spellcheck="false" value="'+esc(draft("lg_code"))+'" placeholder="bv. smaf-kampvuur-2026"></div>';
  h+='<div><label class="lbl" for="lg_name">Jouw naam</label><input type="text" id="lg_name" autocomplete="given-name" value="'+esc(draft("lg_name",S.me))+'" placeholder="bv. Anna of je totem"></div>';
  if(S.loginMsg) h+='<p class="hint" style="color:var(--no)">'+esc(S.loginMsg)+'</p>';
  h+='<button class="btn" data-act="login"'+(S.busy?" disabled":"")+'>'+(S.busy?"Even geduld…":"Openen")+'</button></div>';
  if(S.phase==="nogroup"){
    h+='<div class="card"><h2>Nieuwe groep starten?</h2><p class="hint">Er bestaat nog geen groep met de code <b>'+esc(normCode(draft("lg_code")))+'</b>. Ben jij de eerste die de app instelt? Start dan een nieuwe groep met deze code en geef de code door aan de rest van de leiding.</p><button class="btn ghost" data-act="createGroup"'+(S.busy?" disabled":"")+'>Nieuwe groep starten</button></div>';
  }
  h+='<p class="hint" style="text-align:center">Tip: zet deze pagina op je beginscherm, dan opent ze als een app.</p>';
  el.innerHTML=h;
}

function onboarding(){
  return '<div class="card"><span class="eyebrow">Welkom</span><h2>Maak eerst je tak aan</h2>'+
  '<p class="hint">Een tak is een groep met eigen leden, bv. Kapoenen of Jonggivers. Je kan er later meer toevoegen.</p>'+
  '<div class="row"><input class="grow" type="text" id="newTak0" placeholder="bv. Welpen" value="'+esc(draft("newTak0"))+'"><button class="btn" data-act="addTak" data-src="newTak0">Tak maken</button></div></div>'+
  '<div class="card"><h2>Gegevens van vroeger?</h2><p class="hint">Heb je een backup van een vorige versie van deze app (het losse bestand of de versie in Claude)? Laad die hier en alles wordt overgezet.</p>'+
  '<label class="btn ghost" style="text-align:center">Backup-bestand kiezen<input type="file" id="importFile" data-chg="import" accept="application/json,.json" hidden></label></div>';
}

/* ----- Aanwezigheid ----- */
function renderAtt(){
  const el=$("#v-att"); const tak=curTak();
  if(!tak){el.innerHTML=onboarding();return;}
  if(!S.loaded.acts){el.innerHTML='<div class="card empty">Activiteiten laden…</div>';return;}
  const tl=navTimeline();
  if(!S.curKey||!tl.some(i=>i.key===S.curKey)) S.curKey=pickDefault(tl);
  const idx=tl.findIndex(i=>i.key===S.curKey); const it=tl[idx];
  let h='';
  h+='<div class="card"><div class="actnav"><button class="navbtn" data-act="prev" aria-label="Vorige activiteit"'+(idx<=0?" disabled":"")+'>‹</button><div class="acthead">';
  if(it){
    const a=S.acts[it.key]||{};
    h+='<div class="date">'+esc(cap(fLong(it.date)))+'</div><div class="sub">';
    if(it.date===todayISO()) h+='<span class="tag today">Vandaag</span>';
    h+='<span class="tag kind-'+it.kind+'">'+KIND[it.kind]+'</span>';
    if(a.title) h+='<span class="tag">'+esc(a.title)+'</span>';
    if(a.endDate&&a.endDate!==it.date) h+='<span class="tag">tot '+esc(fShort(a.endDate))+'</span>';
    if(a.blocked) h+='<span class="tag off">Geen activiteit</span>';
    h+='</div>';
  }
  h+='</div><button class="navbtn" data-act="next" aria-label="Volgende activiteit"'+(idx>=tl.length-1?" disabled":"")+'>›</button></div>';
  h+='<div class="row" style="justify-content:center"><button class="btn ghost small" data-act="today">Naar eerstvolgende</button><button class="btn ghost small" data-act="newAct">+ Extra activiteit, weekend of kamp</button></div></div>';

  if(S.form&&(S.form.type==="newAct"||S.form.type==="editAct")) h+=actForm();
  if(!it){el.innerHTML=h+'<div class="card empty">Geen activiteiten gevonden.</div>';return;}

  const a=S.acts[it.key]||{};
  if(it.kind==="vast"){
    h+='<div class="card"><label class="row" style="justify-content:space-between;cursor:pointer"><span><b>Geen activiteit deze dag</b><br><span class="hint">Bv. vakantie of examens. Telt dan niet mee in het overzicht.</span></span><input type="checkbox" id="blockToggle" data-chg="block" style="width:24px;height:24px"'+(a.blocked?" checked":"")+'></label></div>';
  } else {
    h+='<div class="card"><div class="row" style="justify-content:space-between"><span class="hint">'+KIND[it.kind]+(a.endDate&&a.endDate!==it.date?' van '+esc(fShort(it.date))+' tot '+esc(fShortY(a.endDate)):'')+'</span><span class="row">';
    if(S.confirm==="delAct:"+it.key) h+='<span class="hint">Echt verwijderen, met alle aanwezigheden?</span><button class="btn danger small" data-act="delActYes">Ja, verwijder</button><button class="btn ghost small" data-act="cancelConfirm">Nee</button>';
    else h+='<button class="btn ghost small" data-act="editAct">Bewerken</button><button class="btn danger small" data-act="askDelAct">Verwijderen</button>';
    h+='</span></div></div>';
  }
  if(a.blocked){el.innerHTML=h+'<div class="card empty">Op deze dag is er geen activiteit.<br>Ze telt niet mee in het overzicht.</div>';return;}

  const leden=ledenVan(S.takId,false); const recs=a.records||{};
  Object.keys(recs).forEach(mid=>{const l=S.leden[mid]; if(l&&l.takId===S.takId&&l.active===false&&recs[mid]&&(recs[mid].s||recs[mid].n)) leden.push(l);});
  if(!leden.length){el.innerHTML=h+'<div class="card empty">Nog geen leden in deze tak.<br><button class="linkbtn" data-act="view" data-v="set">Voeg leden toe in Beheer</button></div>';return;}
  const c={aanwezig:0,afgemeld:0,afwezig:0}; leden.forEach(l=>{const r=recs[l.id];if(r&&c[r.s]!=null)c[r.s]++;});
  const filled=c.aanwezig+c.afgemeld+c.afwezig;

  h+='<div class="card"><label class="lbl" for="actNote">Notitie bij deze activiteit</label><textarea id="actNote" data-chg="actNote" placeholder="bv. Bosspel in het park, 2 nieuwe leden kwamen proberen">'+esc(draft("actNote:"+it.key,a.note))+'</textarea></div>';
  h+='<div class="card"><div class="row" style="justify-content:space-between"><div class="pills"><span class="pill ok">✓ '+c.aanwezig+'</span><span class="pill msg">✉ '+c.afgemeld+'</span><span class="pill no">✕ '+c.afwezig+'</span></div><span class="hint num">'+filled+' van '+leden.length+' ingevuld</span></div>';
  h+='<div class="progress" aria-hidden="true"><span style="width:'+(leden.length?Math.round(filled/leden.length*100):0)+'%"></span></div>';
  if(filled<leden.length) h+='<button class="btn ghost small" data-act="restAanwezig">Zet de '+(leden.length-filled)+' lege op ✓ aanwezig</button>';
  h+='<div>';
  leden.forEach(l=>{
    const r=recs[l.id]||{}; const open=!!S.openNote[it.key+"|"+l.id];
    const meta=[];
    if(r.s&&r.imp) meta.push("uit vorige versie");
    else if(r.s&&r.by) meta.push("door "+esc(r.by)+(r.at?" · "+esc(fTime(r.at)):""));
    if(r.n&&!open) meta.push('<span class="n">“'+esc(r.n)+'”</span>');
    h+='<div class="lid"><div><div class="lid-name">'+esc(l.name)+(l.active===false?' <span class="arch">(gearchiveerd)</span>':'')+'</div>'+(meta.length?'<div class="lid-meta">'+meta.join(" · ")+'</div>':'')+'</div>';
    h+='<div class="seg" role="group" aria-label="Status van '+esc(l.name)+'">';
    ["aanwezig","afgemeld","afwezig"].forEach(s=>{h+='<button data-act="mark" data-mid="'+esc(l.id)+'" data-s="'+s+'" aria-pressed="'+(r.s===s)+'" title="'+ST[s].l+'" aria-label="'+ST[s].l+'">'+ST[s].g+'</button>';});
    h+='</div><button class="iconbtn'+(r.n?" has":"")+'" data-act="noteToggle" data-mid="'+esc(l.id)+'" aria-expanded="'+open+'" aria-label="Notitie voor '+esc(l.name)+'" title="Notitie">✎</button>';
    if(open) h+='<div class="lid-note"><input type="text" id="ln_'+esc(l.id)+'" data-chg="lidNote" data-mid="'+esc(l.id)+'" placeholder="bv. ziek, kwam later, vergat uniform" value="'+esc(draft("ln:"+it.key+":"+l.id,r.n))+'"></div>';
    h+='</div>';
  });
  h+='</div></div>';
  el.innerHTML=h;
}
function actForm(){
  const f=S.form; const v=k=>draft("af_"+k,f[k]);
  let h='<div class="card"><h2>'+(f.type==="newAct"?"Nieuwe activiteit":"Activiteit bewerken")+'</h2>';
  h+='<div><label class="lbl" for="af_kind">Soort</label><select id="af_kind">'+["extra","weekend","kamp"].map(k=>'<option value="'+k+'"'+(v("kind")===k?" selected":"")+'>'+KIND[k]+'</option>').join("")+'</select></div>';
  h+='<div><label class="lbl" for="af_title">Naam</label><input type="text" id="af_title" placeholder="bv. Kerstfeestje, Pinksterweekend" value="'+esc(v("title"))+'"></div>';
  h+='<div class="row"><div class="grow"><label class="lbl" for="af_date">Van</label><input type="date" id="af_date" value="'+esc(v("date"))+'"></div><div class="grow"><label class="lbl" for="af_end">Tot (optioneel)</label><input type="date" id="af_end" value="'+esc(v("endDate"))+'"></div></div>';
  h+='<div class="row"><button class="btn" data-act="saveAct">Opslaan</button><button class="btn ghost" data-act="cancelForm">Annuleren</button></div></div>';
  return h;
}

/* ----- Overzicht ----- */
const PERIODS=[["week","Week"],["maand","Maand"],["kwartaal","Kwartaal"],["scoutsjaar","Scoutsjaar"],["jaar","Kalenderjaar"]];
function range(type,anchorISO){
  const a=parse(anchorISO), y=a.getFullYear(), m=a.getMonth();
  if(type==="week"){const day=a.getDay();const mon=addDays(a,day===0?-6:1-day);return [iso(mon),iso(addDays(mon,6))];}
  if(type==="maand") return [iso(new Date(y,m,1)),iso(new Date(y,m+1,0))];
  if(type==="kwartaal"){const q=Math.floor(m/3)*3;return [iso(new Date(y,q,1)),iso(new Date(y,q+3,0))];}
  if(type==="scoutsjaar"){const sy=m>=8?y:y-1;return [iso(new Date(sy,8,1)),iso(new Date(sy+1,7,31))];}
  return [iso(new Date(y,0,1)),iso(new Date(y,11,31))];
}
function shift(type,anchorISO,dir){
  const a=parse(anchorISO), y=a.getFullYear(), m=a.getMonth();
  if(type==="week") return iso(addDays(a,dir*7));
  if(type==="maand") return iso(new Date(y,m+dir,1));
  if(type==="kwartaal") return iso(new Date(y,m+dir*3,1));
  return iso(new Date(y+dir,m,1));
}
function periodLabel(type,r){
  const s=parse(r[0]);
  if(type==="week") return fShort(r[0])+" – "+fShortY(r[1]);
  if(type==="maand") return cap(s.toLocaleDateString("nl-BE",{month:"long",year:"numeric"}));
  if(type==="kwartaal") return "Kwartaal "+(Math.floor(s.getMonth()/3)+1)+" · "+s.getFullYear();
  if(type==="scoutsjaar") return "Scoutsjaar "+s.getFullYear()+"–"+(s.getFullYear()+1);
  return String(s.getFullYear());
}
function ovData(){
  const r=range(S.ovPeriod,S.ovAnchor), t=todayISO();
  const items=timeline(r[0],r[1]); const per={}; const rows=[]; let counted=0, leeg=0;
  const addM=id=>per[id]||(per[id]={id,aanwezig:0,afgemeld:0,afwezig:0,hist:[]});
  ledenVan(S.takId,false).forEach(l=>addM(l.id));
  items.forEach(it=>{
    const a=S.acts[it.key]||{};
    if(a.blocked){rows.push(Object.assign({st:"blocked",title:a.title},it));return;}
    if(it.date>t){rows.push(Object.assign({st:"future",title:a.title},it));return;}
    counted++;
    const c={aanwezig:0,afgemeld:0,afwezig:0};
    Object.keys(a.records||{}).forEach(mid=>{
      const rec=a.records[mid]; if(!rec||c[rec.s]==null) return;
      const l=S.leden[mid]; if(l&&l.takId!==S.takId) return;
      addM(mid)[rec.s]++; per[mid].hist.push({date:it.date,kind:it.kind,title:a.title,s:rec.s,n:rec.n}); c[rec.s]++;
    });
    const f=c.aanwezig+c.afgemeld+c.afwezig; if(!f) leeg++;
    rows.push(Object.assign({st:f?"ok":"leeg",c,title:a.title},it));
  });
  let totA=0,totF=0;
  const members=Object.values(per).map(p=>{
    const l=S.leden[p.id]; const f=p.aanwezig+p.afgemeld+p.afwezig; totA+=p.aanwezig; totF+=f;
    return Object.assign(p,{name:l?l.name:"Verwijderd lid",archived:l?l.active===false:true,filled:f,pct:f?Math.round(p.aanwezig/f*100):null});
  }).sort((a,b)=>(b.pct==null?-1:b.pct)-(a.pct==null?-1:a.pct)||collator.compare(a.name,b.name));
  return {r,rows,members,counted,leeg,avg:totF?Math.round(totA/totF*100):null};
}
function renderOv(){
  const el=$("#v-ov"); const tak=curTak();
  if(!tak){el.innerHTML=onboarding();return;}
  if(!S.loaded.acts){el.innerHTML='<div class="card empty">Activiteiten laden…</div>';return;}
  const d=ovData();
  let h='<div class="card"><div class="tabs" role="group" aria-label="Periode">'+PERIODS.map(p=>'<button class="chip" data-act="ovPeriod" data-p="'+p[0]+'" aria-pressed="'+(S.ovPeriod===p[0])+'">'+p[1]+'</button>').join("")+'</div>';
  h+='<div class="actnav"><button class="navbtn" data-act="ovPrev" aria-label="Vorige periode">‹</button><div class="acthead"><div class="date">'+esc(periodLabel(S.ovPeriod,d.r))+'</div></div><button class="navbtn" data-act="ovNext" aria-label="Volgende periode">›</button></div>';
  h+='<div class="stats"><div class="stat"><b class="num">'+d.counted+'</b><span>activiteiten geweest</span></div><div class="stat"><b class="num">'+(d.avg==null?"–":d.avg+"%")+'</b><span>gemiddeld aanwezig</span></div><div class="stat"><b class="num"'+(d.leeg?' style="color:var(--das)"':'')+'>'+d.leeg+'</b><span>niet ingevuld</span></div></div></div>';

  h+='<div class="card"><h2>Per lid</h2><div class="legend"><span><i style="background:var(--ok)"></i>Aanwezig</span><span><i style="background:var(--msg)"></i>Afgemeld</span><span><i style="background:var(--no)"></i>Afwezig zonder bericht</span></div><p class="hint">Percentage = aanwezig op alle ingevulde activiteiten. Onder 50% kleurt rood. Tik op een naam voor de details.</p><div>';
  if(!d.members.length) h+='<p class="hint">Nog geen leden.</p>';
  const maxF=Math.max(1,...d.members.map(m=>m.filled));
  d.members.forEach(m=>{
    const w=x=>(x/maxF*100).toFixed(1)+"%";
    h+='<button class="mrow'+(m.pct!=null&&m.pct<50?" warn":"")+'" data-act="hist" data-mid="'+esc(m.id)+'" aria-expanded="'+(S.openHist===m.id)+'"><span class="nm">'+esc(m.name)+(m.archived?' <span class="hint">(gearchiveerd)</span>':'')+'</span><span class="pct">'+(m.pct==null?"–":m.pct+"%")+'</span>';
    h+='<span class="bar" aria-hidden="true"><i style="width:'+w(m.aanwezig)+';background:var(--ok)"></i><i style="width:'+w(m.afgemeld)+';background:var(--msg)"></i><i style="width:'+w(m.afwezig)+';background:var(--no)"></i></span><span class="cnt">'+m.aanwezig+' · '+m.afgemeld+' · '+m.afwezig+'</span></button>';
    if(S.openHist===m.id){
      h+='<div class="hist">'+(m.hist.length?m.hist.sort((a,b)=>a.date<b.date?1:-1).map(x=>'<div><span class="g '+x.s+'">'+ST[x.s].g+'</span><span class="num">'+esc(fShortY(x.date))+'</span><span>'+esc(x.kind==="vast"?"":(x.title||KIND[x.kind]))+(x.n?' <i>“'+esc(x.n)+'”</i>':'')+'</span></div>').join(""):'<span class="hint">Niets ingevuld in deze periode.</span>')+'</div>';
    }
  });
  h+='</div></div>';

  h+='<div class="card"><h2>Per activiteit</h2><div class="tablewrap"><table><thead><tr><th>Datum</th><th>Soort</th><th class="c">✓</th><th class="c">✉</th><th class="c">✕</th><th>Status</th></tr></thead><tbody>';
  if(!d.rows.length) h+='<tr><td colspan="6" class="hint">Geen activiteiten in deze periode.</td></tr>';
  d.rows.slice().reverse().forEach(r=>{
    const st=r.st==="blocked"?"Geen activiteit":r.st==="future"?"Nog te komen":r.st==="leeg"?"Niet ingevuld":"";
    h+='<tr><td><button class="linkbtn" data-act="goAct" data-key="'+esc(r.key)+'">'+esc(fShortY(r.date))+'</button></td><td>'+esc(r.kind==="vast"?"Vast":(r.title||KIND[r.kind]))+'</td>';
    h+='<td class="c">'+(r.c?r.c.aanwezig:"–")+'</td><td class="c">'+(r.c?r.c.afgemeld:"–")+'</td><td class="c">'+(r.c?r.c.afwezig:"–")+'</td><td class="'+(r.st==="leeg"?"warn":"hint")+'">'+st+'</td></tr>';
  });
  h+='</tbody></table></div></div>';

  h+='<div class="card"><h2>Delen</h2><p class="hint">Kopieer het overzicht om te plakken in een mail of WhatsApp, of download het als CSV voor Excel.</p><div class="row"><button class="btn" data-act="copyOv">Kopieer overzicht</button><button class="btn ghost" data-act="csv">Download CSV</button><a class="btn ghost" style="text-decoration:none" href="'+esc(mailHref(d))+'">Open in mail</a></div></div>';
  el.innerHTML=h;
}
function ovText(d){
  const t=curTak(); const L=[];
  L.push("Aanwezigheden "+(t?t.name:"")+" – "+periodLabel(S.ovPeriod,d.r));
  L.push(d.counted+" activiteiten, gemiddeld "+(d.avg==null?"–":d.avg+"%")+" aanwezig"+(d.leeg?", "+d.leeg+" niet ingevuld":""));
  L.push("");
  L.push("Naam: aanwezig / afgemeld / afwezig (%)");
  d.members.forEach(m=>L.push(m.name+": "+m.aanwezig+" / "+m.afgemeld+" / "+m.afwezig+" ("+(m.pct==null?"–":m.pct+"%")+")"));
  return L.join("\n");
}
function mailHref(d){const t=curTak();return "mailto:?subject="+encodeURIComponent("Aanwezigheden "+(t?t.name+" ":"")+"– "+periodLabel(S.ovPeriod,d.r))+"&body="+encodeURIComponent(ovText(d));}

/* ----- Beheer ----- */
function renderSet(){
  const el=$("#v-set"); const tak=curTak();
  let h='';
  h+='<div class="card"><h2>Jij en de leiding</h2>';
  h+='<div><label class="lbl" for="meName">Jouw naam</label><input type="text" id="meName" data-chg="meName" value="'+esc(draft("meName",S.me))+'" placeholder="Wordt getoond bij wat jij invult"></div>';
  h+='<div><span class="lbl">Leidingscode</span><div class="row"><code class="codebox">'+(S.showCode?esc(S.code):"••••••••")+'</code><button class="btn ghost small" data-act="toggleCode">'+(S.showCode?"Verbergen":"Tonen")+'</button><button class="btn ghost small" data-act="copyInvite">Kopieer uitnodiging</button></div></div>';
  h+='<p class="hint">Nieuwe leiding uitnodigen? Stuur hen de link van deze app en de leidingscode (de knop "Kopieer uitnodiging" maakt een berichtje klaar). Ze hebben geen account nodig. Zet op je gsm deze pagina via het deelmenu van je browser op je beginscherm.</p>';
  if(S.confirm==="logout") h+='<div class="row"><span class="hint">Afmelden op dit toestel? Je hebt de code nodig om terug binnen te geraken.</span><button class="btn danger small" data-act="logoutYes">Afmelden</button><button class="btn ghost small" data-act="cancelConfirm">Nee</button></div>';
  else h+='<div><button class="linkbtn" data-act="askLogout">Afmelden op dit toestel</button></div>';
  h+='</div>';
  if(!tak){el.innerHTML=h+onboarding();return;}

  h+='<div class="card"><h2>Takken</h2><div>';
  takList().forEach(k=>{
    h+='<div class="item"><div class="row"><input class="grow" type="text" id="tn_'+esc(k.id)+'" data-chg="takName" data-id="'+esc(k.id)+'" value="'+esc(draft("tn_"+k.id,k.name))+'" aria-label="Naam van de tak">';
    h+='<select id="tw_'+esc(k.id)+'" data-chg="takWd" data-id="'+esc(k.id)+'" style="width:auto" aria-label="Vaste dag">'+WD.map((w,i)=>'<option value="'+i+'"'+((k.weekday==null?6:k.weekday)===i?" selected":"")+'>'+cap(w)+'</option>').join("")+'</select></div>';
    if(S.confirm==="delTak:"+k.id) h+='<div class="row"><span class="hint">Tak met al haar leden en aanwezigheden verwijderen?</span><button class="btn danger small" data-act="delTakYes" data-id="'+esc(k.id)+'">Ja, verwijder</button><button class="btn ghost small" data-act="cancelConfirm">Nee</button></div>';
    else h+='<div class="row"><button class="linkbtn" data-act="askDelTak" data-id="'+esc(k.id)+'">Tak verwijderen</button></div>';
    h+='</div>';
  });
  h+='</div><div class="row"><input class="grow" type="text" id="newTak" placeholder="Nieuwe tak, bv. Jonggivers" value="'+esc(draft("newTak"))+'"><button class="btn" data-act="addTak" data-src="newTak">Toevoegen</button></div></div>';

  const leden=ledenVan(S.takId,true);
  h+='<div class="card"><h2>Leden van '+esc(tak.name)+'</h2>';
  h+='<div><label class="lbl" for="newLeden">Nieuwe leden (één naam per regel)</label><textarea id="newLeden" placeholder="Anna&#10;Bram&#10;Chloë">'+esc(draft("newLeden"))+'</textarea></div><button class="btn" data-act="addLeden">Leden toevoegen</button>';
  h+='<p class="hint">Iemand gestopt? Kies <b>Archiveren</b>: de naam verdwijnt uit de lijst, maar de oude aanwezigheden blijven meetellen in het overzicht. Zet geen medische of gevoelige info in notities.</p><div>';
  if(!leden.length) h+='<p class="hint">Nog geen leden.</p>';
  leden.forEach(l=>{
    h+='<div class="item'+(l.active===false?" inactive":"")+'"><div class="row"><input class="grow" type="text" id="lnm_'+esc(l.id)+'" data-chg="lidName" data-id="'+esc(l.id)+'" value="'+esc(draft("lnm_"+l.id,l.name))+'" aria-label="Naam">';
    h+='<button class="btn ghost small" data-act="archLid" data-id="'+esc(l.id)+'">'+(l.active===false?"Terugzetten":"Archiveren")+'</button></div>';
    h+='<input type="text" id="lin_'+esc(l.id)+'" data-chg="lidInfo" data-id="'+esc(l.id)+'" placeholder="Algemene notitie (bv. totem, komt met de fiets)" value="'+esc(draft("lin_"+l.id,l.info))+'">';
    if(S.confirm==="delLid:"+l.id) h+='<div class="row"><span class="hint">'+esc(l.name)+' definitief verwijderen?</span><button class="btn danger small" data-act="delLidYes" data-id="'+esc(l.id)+'">Ja</button><button class="btn ghost small" data-act="cancelConfirm">Nee</button></div>';
    else h+='<div><button class="linkbtn" data-act="askDelLid" data-id="'+esc(l.id)+'">Verwijderen</button></div>';
    h+='</div>';
  });
  h+='</div></div>';

  const wdName=WD[tak.weekday==null?6:tak.weekday];
  h+='<div class="card"><h2>Dagen zonder activiteit</h2><p class="hint">Blokkeer in één keer alle '+wdName+'en in een periode, bv. de examens of de zomervakantie.</p>';
  h+='<div class="row"><div class="grow"><label class="lbl" for="bFrom">Van</label><input type="date" id="bFrom" value="'+esc(draft("bFrom"))+'"></div><div class="grow"><label class="lbl" for="bTo">Tot</label><input type="date" id="bTo" value="'+esc(draft("bTo"))+'"></div></div>';
  h+='<button class="btn ghost" data-act="blockRange">Blokkeer deze '+wdName+'en</button>';
  const bl=Object.values(S.acts).filter(a=>a.kind==="vast"&&a.blocked&&a.date>=iso(addDays(today(),-60))).sort((a,b)=>a.date<b.date?-1:1);
  h+='<h3>Geblokkeerd (recent en gepland)</h3><div class="blocked">'+(bl.length?bl.map(a=>'<span>'+esc(fShortY(a.date))+'<button data-act="unblock" data-key="'+esc(a.id)+'" aria-label="Blokkade opheffen">✕</button></span>').join(""):'<span class="hint" style="background:none">Geen.</span>')+'</div></div>';

  h+='<div class="card"><h2>Gegevens</h2><p class="hint">Alles staat online bij Firebase, dus je verliest niets als je van gsm wisselt. Een backup downloaden kan altijd.</p><div class="row"><button class="btn ghost" data-act="backup">Backup downloaden</button>';
  h+='<label class="btn ghost">Backup importeren<input type="file" id="importFile" data-chg="import" accept="application/json,.json" hidden></label></div><p class="hint">Importeren werkt met backups van deze app, van de versie in Claude en van het oude losse bestand. Oude-bestand-backups komen in de tak <b>'+esc(tak.name)+'</b>. Twee keer importeren maakt geen dubbele leden.</p></div>';

  h+='<div class="card"><h2>Leidingscode wijzigen</h2><p class="hint">Doe dit bijvoorbeeld als er iemand uit de leiding stopt. Alle gegevens verhuizen naar de nieuwe code. Iedereen moet daarna opnieuw aanmelden met de nieuwe code. Kies minstens 8 tekens, liefst een paar woorden.</p>';
  h+='<div class="row"><input class="grow" type="text" id="newCode" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="bv. smaf-tentpaal-2027" value="'+esc(draft("newCode"))+'"><button class="btn ghost" data-act="changeCode"'+(S.busy?" disabled":"")+'>'+(S.busy?"Bezig…":"Wijzigen")+'</button></div></div>';
  el.innerHTML=h;
}

/* ---------- actions ---------- */
const act={
  view(e,b){S.view=b.dataset.v;lsSet("view",S.view);S.form=null;S.confirm=null;render();window.scrollTo(0,0);},
  tak(e,b){setTak(b.dataset.id);},
  prev(){const tl=navTimeline();const i=tl.findIndex(x=>x.key===S.curKey);if(i>0){S.curKey=tl[i-1].key;S.confirm=null;render();}},
  next(){const tl=navTimeline();const i=tl.findIndex(x=>x.key===S.curKey);if(i<tl.length-1){S.curKey=tl[i+1].key;S.confirm=null;render();}},
  today(){S.curKey=pickDefault(navTimeline());render();},
  newAct(){S.form={type:"newAct",kind:"extra",title:"",date:todayISO(),endDate:""};clearDrafts("af_");render();},
  editAct(){const a=S.acts[S.curKey];if(!a)return;S.form={type:"editAct",key:a.id,kind:a.kind,title:a.title||"",date:a.date,endDate:a.endDate||""};clearDrafts("af_");render();},
  cancelForm(){S.form=null;clearDrafts("af_");render();},
  saveAct(){
    const kind=$("#af_kind").value, title=$("#af_title").value.trim(), date=$("#af_date").value, end=$("#af_end").value;
    if(!date){toast("Kies een datum.");return;}
    if(end&&end<date){toast("De einddatum ligt voor de begindatum.");return;}
    const data={kind,title:title||KIND[kind],date,endDate:end||""};
    if(S.form.type==="newAct"){ const id=newId("act"); save("act/"+id,Object.assign({takId:S.takId,records:{},note:"",blocked:false},data)); S.curKey=id; toast("Activiteit toegevoegd"); }
    else { save("act/"+S.form.key,data); toast("Opgeslagen"); }
    S.form=null; clearDrafts("af_"); render();
  },
  askDelAct(){S.confirm="delAct:"+S.curKey;render();},
  delActYes(){const key=S.curKey;S.confirm=null;remove("act/"+key);S.curKey=null;toast("Activiteit verwijderd");render();},
  cancelConfirm(){S.confirm=null;render();},
  mark(e,b){
    const it=navTimeline().find(i=>i.key===S.curKey); if(!it) return;
    const mid=b.dataset.mid, s=b.dataset.s, cur=((S.acts[it.key]||{}).records||{})[mid]||{};
    patchAct(it.key,baseFor(it),{records:{[mid]:{s:cur.s===s?"":s,by:S.me||"",at:Date.now(),imp:false}}});
  },
  restAanwezig(){
    const it=navTimeline().find(i=>i.key===S.curKey); if(!it) return;
    const recs=(S.acts[it.key]||{}).records||{}; const p={}; const now=Date.now();
    ledenVan(S.takId,false).forEach(l=>{const r=recs[l.id];if(!r||!r.s)p[l.id]={s:"aanwezig",by:S.me||"",at:now,imp:false};});
    patchAct(it.key,baseFor(it),{records:p}); toast(Object.keys(p).length+" leden op aanwezig gezet");
  },
  noteToggle(e,b){const k=S.curKey+"|"+b.dataset.mid;S.openNote[k]=!S.openNote[k];render();if(S.openNote[k]){const i=document.getElementById("ln_"+b.dataset.mid);if(i)i.focus();}},
  ovPeriod(e,b){S.ovPeriod=b.dataset.p;lsSet("ovPeriod",S.ovPeriod);S.openHist=null;render();},
  ovPrev(){S.ovAnchor=shift(S.ovPeriod,range(S.ovPeriod,S.ovAnchor)[0],-1);S.openHist=null;render();},
  ovNext(){S.ovAnchor=shift(S.ovPeriod,range(S.ovPeriod,S.ovAnchor)[0],1);S.openHist=null;render();},
  hist(e,b){S.openHist=S.openHist===b.dataset.mid?null:b.dataset.mid;render();},
  goAct(e,b){S.curKey=b.dataset.key;S.view="att";lsSet("view","att");render();window.scrollTo(0,0);},
  copyOv(){copyText(ovText(ovData()),"Overzicht gekopieerd");},
  csv(){
    const d=ovData(); const L=["Naam;Aanwezig;Afgemeld;Afwezig zonder bericht;Percentage aanwezig"];
    const q=s=>'"'+String(s).replace(/"/g,'""')+'"';
    d.members.forEach(m=>L.push([q(m.name),m.aanwezig,m.afgemeld,m.afwezig,m.pct==null?"":m.pct].join(";")));
    L.push("");L.push("Datum;Soort;Aanwezig;Afgemeld;Afwezig;Status");
    d.rows.forEach(r=>L.push([r.date,q(r.kind==="vast"?"Vast":(r.title||KIND[r.kind])),r.c?r.c.aanwezig:"",r.c?r.c.afgemeld:"",r.c?r.c.afwezig:"",r.st].join(";")));
    const t=curTak();
    downloadFile("aanwezigheden_"+((t&&t.name)||"tak").replace(/[^a-z0-9]+/gi,"_")+"_"+periodLabel(S.ovPeriod,d.r).replace(/[^a-z0-9]+/gi,"_")+".csv","﻿"+L.join("\r\n"),"text/csv;charset=utf-8");
  },
  addTak(e,b){
    const src=b.dataset.src, inp=$("#"+src), name=inp&&inp.value.trim(); if(!name){toast("Geef de tak een naam.");return;}
    const id=newId("takken"); save("takken/"+id,{name,weekday:6,order:takList().length,createdAt:Date.now()});
    delete S.drafts[src]; S.takken[id]={id,name,weekday:6}; setTak(id); toast("Tak "+name+" gemaakt");
  },
  askDelTak(e,b){S.confirm="delTak:"+b.dataset.id;render();},
  async delTakYes(e,b){
    const id=b.dataset.id; S.confirm=null;
    Object.values(S.leden).filter(l=>l.takId===id).forEach(l=>remove("leden/"+l.id));
    try{(await getDocs(query(cref("act"),where("takId","==",id)))).docs.forEach(d=>remove("act/"+d.id));}catch(err){}
    remove("takken/"+id); toast("Tak verwijderd");
  },
  addLeden(){
    const names=($("#newLeden").value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!names.length){toast("Typ minstens één naam.");return;}
    names.forEach(name=>save("leden/"+newId("leden"),{takId:S.takId,name,active:true,info:"",createdAt:Date.now()}));
    delete S.drafts.newLeden; $("#newLeden").value=""; toast(names.length===1?"Lid toegevoegd":names.length+" leden toegevoegd");
  },
  archLid(e,b){const l=S.leden[b.dataset.id];if(l)save("leden/"+l.id,{active:l.active===false});},
  askDelLid(e,b){S.confirm="delLid:"+b.dataset.id;render();},
  delLidYes(e,b){S.confirm=null;remove("leden/"+b.dataset.id);toast("Lid verwijderd");},
  blockRange(){
    const from=$("#bFrom").value,to=$("#bTo").value;
    if(!from||!to){toast("Kies een van- en een tot-datum.");return;}
    if(to<from){toast("De tot-datum ligt voor de van-datum.");return;}
    const tak=curTak(); let n=0;
    for(let d=onOrAfter(parse(from),tak.weekday==null?6:tak.weekday);iso(d)<=to;d=addDays(d,7)){const ds=iso(d);patchAct(rkey(tak.id,ds),{takId:tak.id,date:ds,kind:"vast"},{blocked:true});n++;}
    delete S.drafts.bFrom; delete S.drafts.bTo; toast(n+" dag(en) geblokkeerd"); render();
  },
  unblock(e,b){const a=S.acts[b.dataset.key];if(a)patchAct(a.id,{takId:a.takId,date:a.date,kind:"vast"},{blocked:false});},
  async backup(){
    try{
      const [t,l,a]=await Promise.all(["takken","leden","act"].map(c=>getDocs(cref(c))));
      const dump=q=>q.docs.map(d=>Object.assign({id:d.id},d.data()));
      downloadFile("smaf_aanwezigheden_backup_"+todayISO()+".json",JSON.stringify({format:"scouts-aanwezigheden-v2",exported:new Date().toISOString(),takken:dump(t),leden:dump(l),activiteiten:dump(a)},null,2),"application/json");
    }catch(err){console.error(err);toast("Backup maken lukte niet.");}
  },
  toggleCode(){S.showCode=!S.showCode;render();},
  copyInvite(){copyText("Hoi! Dit is onze aanwezigheden-app van de scouts:\n"+location.href.split("#")[0]+"\n\nLeidingscode: "+S.code+"\n\nTip: open de link en zet hem via het deelmenu op je beginscherm.","Uitnodiging gekopieerd");},
  askLogout(){S.confirm="logout";render();},
  logoutYes(){S.confirm=null;logout("");},
  async login(){
    const code=normCode($("#lg_code").value), name=$("#lg_name").value.trim();
    S.drafts.lg_code=$("#lg_code").value; S.drafts.lg_name=name;
    if(code.length<8){S.loginMsg="De leidingscode heeft minstens 8 tekens.";render();return;}
    if(!name){S.loginMsg="Vul ook je naam in.";render();return;}
    S.busy=true;S.loginMsg="";render();
    try{
      const snap=await getDoc(doc(fs,"groepen/"+code+"/meta/info"));
      S.busy=false;
      if(snap.exists()){ S.me=name; lsSet("naam",name); enter(code); }
      else { S.phase="nogroup"; render(); }
    }catch(err){ console.error(err); S.busy=false; S.loginMsg=navigator.onLine?"Aanmelden lukte niet. Controleer de code en probeer opnieuw.":"Je bent offline. Aanmelden kan alleen met internet."; render(); }
  },
  async createGroup(){
    const code=normCode(draft("lg_code")), name=draft("lg_name").trim();
    if(code.length<8||!name){S.phase="login";render();return;}
    S.busy=true;render();
    try{ await setDoc(doc(fs,"groepen/"+code+"/meta/info"),{createdAt:Date.now(),createdBy:name}); S.busy=false; S.me=name; lsSet("naam",name); enter(code); toast("Nieuwe groep gestart"); }
    catch(err){ console.error(err); S.busy=false; S.loginMsg="Starten lukte niet. Controleer de Firebase-instellingen."; S.phase="login"; render(); }
  },
  async changeCode(){
    const nc=normCode($("#newCode").value);
    if(nc.length<8){toast("De nieuwe code heeft minstens 8 tekens.");return;}
    if(nc===S.code){toast("Dat is de huidige code.");return;}
    if(!navigator.onLine){toast("Hiervoor heb je internet nodig.");return;}
    S.busy=true;render();
    try{
      const nb="groepen/"+nc+"/";
      if((await getDoc(doc(fs,nb+"meta/info"))).exists()){S.busy=false;toast("Die code is al in gebruik. Kies een andere.");render();return;}
      const all=[];
      for(const c of ["takken","leden","act"]) (await getDocs(cref(c))).docs.forEach(d=>all.push([c,d.id,d.data()]));
      for(let i=0;i<all.length;i+=400){const b=writeBatch(fs);all.slice(i,i+400).forEach(([c,id,data])=>b.set(doc(fs,nb+c+"/"+id),data));await b.commit();}
      await setDoc(doc(fs,nb+"meta/info"),{createdAt:Date.now(),createdBy:S.me||"",movedFrom:true});
      for(let i=0;i<all.length;i+=400){const b=writeBatch(fs);all.slice(i,i+400).forEach(([c,id])=>b.delete(dref(c+"/"+id)));await b.commit();}
      const old=S.code; S.busy=false; delete S.drafts.newCode;
      S.showCode=true; S.view="set"; enter(nc);
      await deleteDoc(doc(fs,"groepen/"+old+"/meta/info")); toast("Leidingscode gewijzigd. Geef de nieuwe code door aan de leiding.");
    }catch(err){console.error(err);S.busy=false;toast("Wijzigen lukte niet. Probeer opnieuw.");render();}
  }
};
function clearDrafts(prefix){Object.keys(S.drafts).forEach(k=>{if(k.indexOf(prefix)===0)delete S.drafts[k];});}
function setTak(id){if(S.takId!==id){S.takId=id;lsSet("tak",id);S.curKey=null;S.form=null;S.confirm=null;S.openHist=null;subActs();}render();}
function downloadFile(filename,data,type){
  const blob=new Blob([data],{type});const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
async function copyText(txt,msg){
  try{await navigator.clipboard.writeText(txt);toast(msg);}
  catch(err){
    const c=document.createElement("div");c.className="card";
    c.innerHTML='<h2>Kopieer deze tekst</h2><p class="hint">Automatisch kopiëren lukte niet. Selecteer de tekst en kopieer hem zelf.</p><textarea id="copyBox" rows="8" readonly></textarea>';
    $("#v-"+S.view).appendChild(c);const t=$("#copyBox");t.value=txt;t.focus();t.select();c.scrollIntoView({behavior:"smooth"});
  }
}

const chg={
  actNote(e,el){const it=navTimeline().find(i=>i.key===S.curKey);if(!it)return;patchAct(it.key,baseFor(it),{note:el.value});delete S.drafts["actNote:"+it.key];},
  lidNote(e,el){const it=navTimeline().find(i=>i.key===S.curKey);if(!it)return;const mid=el.dataset.mid;patchAct(it.key,baseFor(it),{records:{[mid]:{n:el.value.trim()}}});delete S.drafts["ln:"+it.key+":"+mid];toast("Notitie bewaard");},
  block(e,el){const it=navTimeline().find(i=>i.key===S.curKey);if(!it)return;patchAct(it.key,baseFor(it),{blocked:el.checked});},
  takName(e,el){const v=el.value.trim();if(!v)return;save("takken/"+el.dataset.id,{name:v});delete S.drafts["tn_"+el.dataset.id];},
  takWd(e,el){save("takken/"+el.dataset.id,{weekday:Number(el.value)});toast("Vaste dag aangepast");},
  lidName(e,el){const v=el.value.trim();if(!v)return;save("leden/"+el.dataset.id,{name:v});delete S.drafts["lnm_"+el.dataset.id];},
  lidInfo(e,el){save("leden/"+el.dataset.id,{info:el.value.trim()});delete S.drafts["lin_"+el.dataset.id];},
  meName(e,el){const v=el.value.trim();if(!v)return;S.me=v;lsSet("naam",v);delete S.drafts.meName;toast("Naam bewaard");},
  import(e,el){const f=el.files&&el.files[0];el.value="";if(f)importFile(f);}
};
const draftKey=el=>{
  const id=el.id;
  if(id==="actNote") return "actNote:"+S.curKey;
  if(id.indexOf("ln_")===0) return "ln:"+S.curKey+":"+el.dataset.mid;
  return id;
};
document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b||b.disabled)return;const f=act[b.dataset.act];if(f){e.preventDefault();f(e,b);}});
document.addEventListener("change",e=>{const el=e.target.closest("[data-chg]");if(!el)return;const f=chg[el.dataset.chg];if(f)f(e,el);});
document.addEventListener("input",e=>{const el=e.target;if(el.id&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT")&&el.type!=="file")S.drafts[draftKey(el)]=el.value;});
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter"||e.target.tagName!=="INPUT") return;
  const id=e.target.id;
  if(id==="newTak"||id==="newTak0"){e.preventDefault();act.addTak(e,{dataset:{src:id}});}
  else if(id==="lg_code"||id==="lg_name"){e.preventDefault();act.login();}
  else if(id.indexOf("ln_")===0){e.target.blur();}
});
window.addEventListener("online",render);window.addEventListener("offline",render);

/* ---------- import ---------- */
async function importFile(file){
  let data; try{data=JSON.parse(await file.text());}catch(err){toast("Dit bestand kon niet gelezen worden.");return;}
  if(data&&data.format==="scouts-aanwezigheden-v2") return importV2(data);
  if(!data||!Array.isArray(data.members)){toast("Dit bestand is geen backup van de aanwezigheden-app.");return;}
  toast("Bezig met importeren…");
  let takId=S.takId;
  if(!takId){ takId=newId("takken"); save("takken/"+takId,{name:(data.troop||"Mijn tak").trim()||"Mijn tak",weekday:6,order:0,createdAt:Date.now()}); S.takken[takId]={id:takId,name:data.troop||"Mijn tak",weekday:6}; setTak(takId); }
  const idMap={};
  data.members.forEach(m=>{
    if(!m||!m.name) return;
    const nid=("imp_"+takId+"_"+String(m.id||m.name)).replace(/[^A-Za-z0-9_\-.~:@+]/g,"_").slice(0,180); idMap[m.id]=nid;
    save("leden/"+nid,{takId,name:m.name,active:m.active!==false,info:"",createdAt:Date.now()});
  });
  let n=0; const blocked=data.blockedDates||[];
  new Set(Object.keys(data.attendance||{}).concat(blocked)).forEach(ds=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
    const recs={}; const src=(data.attendance||{})[ds]||{};
    Object.keys(src).forEach(mid=>{if(idMap[mid]&&ST[src[mid]])recs[idMap[mid]]={s:src[mid],imp:true,at:Date.now()};});
    const patch={records:recs}; if(blocked.indexOf(ds)>-1) patch.blocked=true;
    patchAct(rkey(takId,ds),{takId,date:ds,kind:"vast"},patch); n++;
  });
  toast("Geïmporteerd: "+Object.keys(idMap).length+" leden en "+n+" dagen");
}
async function importV2(data){
  toast("Bezig met importeren…");
  const items=[];
  (data.takken||[]).forEach(t=>items.push(["takken",t]));
  (data.leden||[]).forEach(l=>items.push(["leden",l]));
  (data.activiteiten||[]).forEach(a=>{
    const r={}; Object.keys(a.records||{}).forEach(mid=>{const x=a.records[mid]||{};r[mid]={s:x.s||"",n:x.n||"",at:x.at||Date.now(),imp:true};});
    items.push(["act",Object.assign({},a,{records:r})]);
  });
  try{
    for(let i=0;i<items.length;i+=400){
      const b=writeBatch(fs);
      items.slice(i,i+400).forEach(([c,o])=>{ if(!o||!o.id) return; const d=Object.assign({},o); delete d.id; b.set(dref(c+"/"+o.id),d,{merge:true}); });
      await b.commit();
    }
    toast("Geïmporteerd: "+(data.takken||[]).length+" takken, "+(data.leden||[]).length+" leden, "+(data.activiteiten||[]).length+" activiteiten");
  }catch(err){console.error(err);toast("Importeren lukte niet volledig. Probeer opnieuw met internet.");}
}

/* ---------- live data ---------- */
function onErr(e){console.error(e); if(e&&e.code==="permission-denied") logout("Geen toegang meer. Is de leidingscode veranderd?");}
function subActs(){
  if(S.unActs){S.unActs();S.unActs=null;}
  S.acts={};S.loaded.acts=false;
  if(!S.takId) return;
  const want=S.takId;
  S.unActs=onSnapshot(query(cref("act"),where("takId","==",want)),snap=>{
    if(S.takId!==want) return;
    const m={};snap.docs.forEach(d=>{m[d.id]=Object.assign({id:d.id},d.data());});
    S.acts=m;S.loaded.acts=true;render();
  },onErr);
}
function stopAll(){S.unsubs.forEach(u=>u());S.unsubs=[];if(S.unActs){S.unActs();S.unActs=null;}}
function enter(code){
  stopAll();
  S.code=code; lsSet("code",code); B="groepen/"+code+"/"; S.phase="app";
  S.takken={};S.leden={};S.acts={};S.loaded={takken:false,leden:false,acts:false};
  S.unsubs.push(onSnapshot(doc(fs,B+"meta/info"),snap=>{
    if(!snap.exists()&&!snap.metadata.fromCache&&S.code===code) logout("De leidingscode is veranderd. Vraag de nieuwe code aan de leiding.");
  },onErr));
  S.unsubs.push(onSnapshot(cref("takken"),snap=>{
    const m={};snap.docs.forEach(d=>{m[d.id]=Object.assign({id:d.id},d.data());});
    S.takken=m;S.loaded.takken=true;
    if(!S.takken[S.takId]){const f=takList()[0];S.takId=f?f.id:null;lsSet("tak",S.takId);subActs();}
    else if(!S.unActs) subActs();
    render();
  },onErr));
  S.unsubs.push(onSnapshot(cref("leden"),snap=>{
    const m={};snap.docs.forEach(d=>{m[d.id]=Object.assign({id:d.id},d.data());});
    S.leden=m;S.loaded.leden=true;render();
  },onErr));
  render();
}
function logout(msg){
  stopAll(); S.code=null; lsSet("code",null); B=""; S.phase="login"; S.loginMsg=msg||""; S.takken={};S.leden={};S.acts={};
  render();
}

/* ---------- boot ---------- */
if(!configured){ S.phase="noconfig"; render(); }
else {
  render();
  onAuthStateChanged(auth,u=>{
    if(!u) return;
    if(S.phase!=="boot") return;
    if(S.code) enter(S.code); else { S.phase="login"; render(); }
  });
  signInAnonymously(auth).catch(err=>{
    console.error(err);
    if(S.code&&auth.currentUser==null&&!navigator.onLine){ enter(S.code); return; }
    S.phase="login"; S.loginMsg="Verbinden met Firebase lukte niet. Controleer je internet, of 'Anoniem aanmelden' aan staat in Firebase."; render();
  });
}
if("serviceWorker" in navigator&&location.protocol==="https:"){navigator.serviceWorker.register("sw.js").catch(()=>{});}
