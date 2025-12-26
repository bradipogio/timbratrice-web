const $ = (id) => document.getElementById(id);

const state = {
  active: null,      // turno attivo locale
  history: [],       // lista
  timer: null
};

const cfg = {
  get endpoint(){ return localStorage.getItem("wr_ep") || ""; },
  set endpoint(v){ localStorage.setItem("wr_ep", v || ""); },
  get token(){ return localStorage.getItem("wr_token") || ""; },
  set token(v){ localStorage.setItem("wr_token", v || ""); },
  get report(){ return localStorage.getItem("wr_report") || "badge-ore"; },
  set report(v){ localStorage.setItem("wr_report", v || ""); }
};

function fmt2(n){ return String(n).padStart(2,"0"); }
function fmtHHMM(seconds){
  const m = Math.max(0, Math.floor(seconds/60));
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h}:${fmt2(mm)}`;
}
function fmtDateTimeISOToYMDHM(iso){
  if(!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = fmt2(d.getMonth()+1);
  const da = fmt2(d.getDate());
  const hh = fmt2(d.getHours());
  const mm = fmt2(d.getMinutes());
  return `${y}/${mo}/${da} ${hh}:${mm}`;
}
function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`;
}

function setStatus(kind){
  const pill = $("statusPill");
  const big = $("bigIcon");
  pill.className = "pill " + (kind==="ready"?"ready":kind==="run"?"run":"pause");
  if(kind==="ready"){ pill.textContent="Pronto"; pill.style.display="inline-flex"; big.textContent="✅"; }
  if(kind==="run"){ pill.textContent=""; pill.style.display="none"; big.textContent="⏱️"; }
  if(kind==="pause"){ pill.textContent=""; pill.style.display="none"; big.textContent="⏸️"; }
}

function computePauseSeconds(rec, now=new Date()){
  const base = (rec.pauseMin||0)*60;
  if(rec.breakStartISO){
    const b = new Date(rec.breakStartISO);
    return base + Math.max(0, (now-b)/1000);
  }
  return base;
}
function computeWorkedSeconds(rec, now=new Date()){
  const start = new Date(rec.startISO);
  const end = rec.endISO ? new Date(rec.endISO) : now;
  const total = Math.max(0, (end-start)/1000);
  return Math.max(0, total - computePauseSeconds(rec, now));
}

async function post(action, payload={}){
  const ep = cfg.endpoint.trim();
  const tk = cfg.token.trim();
  if(!ep || !ep.endsWith("/exec")) throw new Error("Endpoint non valido (deve finire con /exec).");
  if(!tk) throw new Error("Token mancante.");
  const body = { token: tk, action, ...payload };
  const res = await fetch(ep, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  let json;
  try{ json = JSON.parse(txt); } catch { throw new Error("Risposta non JSON: " + txt.slice(0,120)); }
  if(!json.ok) throw new Error(json.error || "Errore");
  return json;
}

function localLoad(){
  try{
    const raw = localStorage.getItem("wr_local");
    const obj = raw ? JSON.parse(raw) : { active:null, history:[] };
    state.active = obj.active || null;
    state.history = Array.isArray(obj.history) ? obj.history : [];
  }catch{
    state.active=null; state.history=[];
  }
}
function localSave(){
  localStorage.setItem("wr_local", JSON.stringify({ active: state.active, history: state.history }));
}

function upsertLocal(rec){
  const idx = state.history.findIndex(x=>x.remoteId===rec.remoteId);
  if(idx>=0) state.history[idx]=rec;
  else state.history.push(rec);
  localSave();
}

async function refreshFromRemote(){
  const r = await post("list");
  // r.rows: [{remoteId,title,startISO,endISO,pauseMin,workMin,km,notes}]
  // Ricostruiamo l’active: quello senza endISO (se presente)
  const rows = r.rows || [];
  const active = rows.find(x => !x.endISO) || null;
  const hist = rows.filter(x => !!x.endISO);

  state.active = active;
  state.history = hist.sort((a,b)=> new Date(b.startISO)-new Date(a.startISO));
  localSave();
}

function applyFilter(list){
  const on = $("filterToggle").checked;
  const qFrom = $("fromDate").value;
  const qTo = $("toDate").value;
  if(!on || !qFrom || !qTo) return list;

  const from = new Date(qFrom + "T00:00:00");
  const to = new Date(qTo + "T23:59:59");
  return list.filter(r=>{
    const t = new Date(r.startISO);
    return t>=from && t<=to;
  });
}

function updateSummary(filtered){
  const turns = filtered.length;
  const now = new Date();
  const sumWork = filtered.reduce((a,r)=> a + computeWorkedSeconds(r, now), 0);
  const sumKm = filtered.reduce((a,r)=> a + (Number(r.km)||0), 0);

  $("sumTurns").textContent = String(turns);
  $("sumHours").textContent = fmtHHMM(sumWork);
  $("sumKm").textContent = String(Math.round(sumKm));

  const on = $("filterToggle").checked;
  if(on && $("fromDate").value && $("toDate").value){
    $("rangeText").textContent = `Selezione: ${$("fromDate").value} → ${$("toDate").value}`;
  } else {
    $("rangeText").textContent = "Storico: tutti";
  }
}

function render(){
  const now = new Date();
  const a = state.active;

  if(!a){
    setStatus("ready");
    $("netTime").textContent = "0:00";
    $("pauseVal").textContent = "0:00";
    $("kmVal").textContent = "0";
    $("btnStart").disabled = false;
    $("btnBreak").disabled = true;
    $("btnStop").disabled = true;
    $("titleInput").value = "";
    $("kmInput").value = "";
  } else {
    const isOnBreak = !!a.breakStartISO;
    setStatus(isOnBreak ? "pause" : "run");

    $("netTime").textContent = fmtHHMM(computeWorkedSeconds(a, now));
    $("pauseVal").textContent = fmtHHMM(computePauseSeconds(a, now));
    $("kmVal").textContent = String(Math.round(Number(a.km)||0));

    $("btnStart").disabled = true;
    $("btnBreak").disabled = false;
    $("btnBreak").textContent = isOnBreak ? "Fine pausa" : "Inizia pausa";
    $("btnStop").disabled = false;

    $("titleInput").value = a.title || "";
    $("kmInput").value = a.km ? String(Math.round(a.km)) : "";
  }

  const filtered = applyFilter(state.history);
  updateSummary(filtered);

  const list = $("list");
  list.innerHTML = "";
  $("empty").classList.toggle("hidden", filtered.length!==0);

  for(const r of filtered){
    const pauseSec = computePauseSeconds(r, new Date(r.endISO || now));
    const workSec  = computeWorkedSeconds(r, new Date(r.endISO || now));
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${escapeHtml(r.title||"Senza titolo")}</div>
        <div class="sub">${fmtDateTimeISOToYMDHM(r.startISO)}</div>
      </div>
      <div class="itemMeta">
        <span>Fine: ${fmtDateTimeISOToYMDHM(r.endISO)}</span>
        <span>Pausa: ${fmtHHMM(pauseSec)}</span>
        <span>Netto: ${fmtHHMM(workSec)}</span>
        <span>Km: ${Math.round(Number(r.km)||0)}</span>
      </div>
      <div class="itemBtns">
        <button class="del">Elimina</button>
      </div>
    `;
    el.querySelector(".del").onclick = async ()=>{
      if(!confirm("Eliminare questo turno?")) return;
      // best effort: delete remoto, poi locale
      try{ await post("delete", { remoteId: r.remoteId }); }catch(e){}
      state.history = state.history.filter(x=>x.remoteId!==r.remoteId);
      localSave(); render();
    };
    list.appendChild(el);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ACTIONS
async function startShift(){
  const title = $("titleInput").value.trim();
  const km = parseInt($("kmInput").value.trim() || "0", 10) || 0;
  const now = new Date();

  const rec = {
    remoteId: crypto.randomUUID(),
    title: title || `Turno ${now.getFullYear()}/${fmt2(now.getMonth()+1)}/${fmt2(now.getDate())}`,
    startISO: now.toISOString(),
    endISO: "",
    pauseMin: 0,
    workMin: 0,
    km: km,
    notes: "",
    breakStartISO: ""
  };

  state.active = rec;
  localSave();
  render();

  // sync remoto (upsert)
  try{
    await post("upsert", {
      record: {
        remoteId: rec.remoteId,
        title: rec.title,
        startISO: rec.startISO,
        endISO: "",
        pauseMin: 0,
        workMin: 0,
        km: rec.km,
        notes: ""
      }
    });
  }catch(e){
    alert("Sync fallita: " + e.message);
  }
}

async function toggleBreak(){
  const a = state.active;
  if(!a) return;
  const now = new Date();

  if(!a.breakStartISO){
    a.breakStartISO = now.toISOString();
  } else {
    const b = new Date(a.breakStartISO);
    const addMin = Math.max(0, Math.floor((now - b) / 60000));
    a.pauseMin = (Number(a.pauseMin)||0) + addMin;
    a.breakStartISO = "";
  }

  localSave();
  render();

  // upsert remoto (aggiorna pauseMin)
  try{
    const workMinNow = Math.max(0, Math.floor(computeWorkedSeconds(a, new Date())/60));
    await post("upsert", {
      record: {
        remoteId: a.remoteId,
        title: a.title,
        startISO: a.startISO,
        endISO: "",
        pauseMin: Number(a.pauseMin)||0,
        workMin: workMinNow,
        km: Number(a.km)||0,
        notes: ""
      }
    });
  }catch(e){
    alert("Sync fallita: " + e.message);
  }
}

async function stopShift(){
  const a = state.active;
  if(!a) return;
  if(!confirm("Finire il turno?")) return;

  // chiudi eventuale pausa in corso
  if(a.breakStartISO){
    await toggleBreak(); // lo chiude e salva pauseMin
  }

  const now = new Date();
  a.endISO = now.toISOString();
  a.workMin = Math.max(0, Math.floor(computeWorkedSeconds(a, now)/60));

  // sposta in history
  upsertLocal(a);
  state.history.sort((x,y)=> new Date(y.startISO)-new Date(x.startISO));
  state.active = null;
  localSave();
  render();

  try{
    await post("upsert", {
      record: {
        remoteId: a.remoteId,
        title: a.title,
        startISO: a.startISO,
        endISO: a.endISO,
        pauseMin: Number(a.pauseMin)||0,
        workMin: Number(a.workMin)||0,
        km: Number(a.km)||0,
        notes: ""
      }
    });
  }catch(e){
    alert("Sync fallita: " + e.message);
  }
}

function exportCSV(){
  const sep = ";";
  const filtered = applyFilter(state.history);
  const now = new Date();

  const rows = [];
  rows.push(["Titolo","DataOraInizio","DataOraFine","Pausa_hh:mm","Ore_nette_hh:mm","Km"].join(sep));

  let sumWork=0, sumPause=0, sumKm=0;

  for(const r of filtered.slice().reverse()){
    const pauseSec = computePauseSeconds(r, new Date(r.endISO || now));
    const workSec  = computeWorkedSeconds(r, new Date(r.endISO || now));
    sumWork += workSec;
    sumPause += pauseSec;
    sumKm += Number(r.km)||0;

    rows.push([
      csvEsc(r.title||""),
      fmtDateTimeISOToYMDHM(r.startISO),
      fmtDateTimeISOToYMDHM(r.endISO),
      fmtHHMM(pauseSec),
      fmtHHMM(workSec),
      String(Math.round(Number(r.km)||0))
    ].join(sep));
  }

  rows.push(["TOTALE SELEZIONE","","",fmtHHMM(sumPause),fmtHHMM(sumWork),String(Math.round(sumKm))].join(sep));
  rows.push("");
  rows.push(["RIEPILOGO","","","","",""].join(sep));
  rows.push(["Turni", String(filtered.length),"","","",""].join(sep));
  rows.push(["Ore totali (nette)", fmtHHMM(sumWork),"","","",""].join(sep));
  rows.push(["Km totali", String(Math.round(sumKm)),"","","",""].join(sep));

  const blob = new Blob(["\uFEFF" + rows.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  const name = (cfg.report || "badge-ore").replace(/\s+/g,"-");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function csvEsc(s){
  const t = String(s).trim();
  if(/[;"\r\n]/.test(t)) return `"${t.replace(/"/g,'""')}"`;
  return t;
}

// Settings
function openSettings(){
  $("epInput").value = cfg.endpoint;
  $("tokenInput").value = cfg.token;
  $("reportInput").value = cfg.report;
  $("settingsMsg").textContent = "";
  $("settingsDlg").showModal();
}
function saveSettings(){
  cfg.endpoint = $("epInput").value.trim();
  cfg.token = $("tokenInput").value.trim();
  cfg.report = $("reportInput").value.trim() || "badge-ore";
}
async function ping(){
  saveSettings();
  try{
    await post("ping");
    $("settingsMsg").textContent = "✅ OK: endpoint risponde.";
  }catch(e){
    $("settingsMsg").textContent = "❌ " + e.message;
  }
}

// Wiring
function boot(){
  localLoad();

  // default filtro date (oggi→oggi)
  $("fromDate").value = todayStr();
  $("toDate").value = todayStr();

  $("btnSettings").onclick = openSettings;
  $("settingsDlg").addEventListener("close", ()=> saveSettings());
  $("btnPing").onclick = (e)=>{ e.preventDefault(); ping(); };

  $("btnStart").onclick = startShift;
  $("btnBreak").onclick = toggleBreak;
  $("btnStop").onclick = stopShift;

  $("btnRefresh").onclick = async ()=>{
    try{ await refreshFromRemote(); render(); }
    catch(e){ alert(e.message); }
  };

  $("btnExport").onclick = exportCSV;

  $("filterToggle").onchange = ()=>{
    $("filterBox").classList.toggle("hidden", !$("filterToggle").checked);
    render();
  };
  $("fromDate").onchange = render;
  $("toDate").onchange = render;

  // edit live su titolo/km del turno attivo
  $("titleInput").addEventListener("change", async ()=>{
    if(!state.active) return;
    state.active.title = $("titleInput").value.trim();
    localSave(); render();
    try{
      await post("upsert", { record: {
        remoteId: state.active.remoteId,
        title: state.active.title,
        startISO: state.active.startISO,
        endISO: "",
        pauseMin: Number(state.active.pauseMin)||0,
        workMin: Math.max(0, Math.floor(computeWorkedSeconds(state.active, new Date())/60)),
        km: Number(state.active.km)||0,
        notes: ""
      }});
    }catch{}
  });

  $("kmInput").addEventListener("change", async ()=>{
    if(!state.active) return;
    const km = parseInt($("kmInput").value.trim()||"0",10) || 0;
    state.active.km = km;
    localSave(); render();
    try{
      await post("upsert", { record: {
        remoteId: state.active.remoteId,
        title: state.active.title,
        startISO: state.active.startISO,
        endISO: "",
        pauseMin: Number(state.active.pauseMin)||0,
        workMin: Math.max(0, Math.floor(computeWorkedSeconds(state.active, new Date())/60)),
        km: Number(state.active.km)||0,
        notes: ""
      }});
    }catch{}
  });

  // Tick UI ogni 1s se turno attivo
  state.timer = setInterval(()=>{ if(state.active) render(); }, 1000);

  render();
}
boot();