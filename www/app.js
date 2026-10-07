/* シフト手帳 v1.1 - app.js */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const EV_COLORS = ['#8a8f9e','#ff8fab','#ffb347','#7bd389','#6fb7ff','#b48cff','#ffd166','#4ecdc4'];
const COLORS = ['#2f6fed','#e0433a','#1fa864','#e8a300','#8e44ad','#16a085','#e67e22','#ff5c8a','#607d8b','#795548'];
const KEY = 'shiftnote.v1';
const DOW = '日月火水木金土';
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const fmtH = min => { const h = Math.floor(min/60), m = min%60; return m ? `${h}時間${m}分` : `${h}時間`; };
const shortT = t => t.replace(/^0/,'').replace(':00','');
const mdw = ds => { const d=parseD(ds); return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- state ---------- */
let state = load();
let cur = new Date(); cur.setDate(1);
let quickPattern = null;   // {wid, pat}
let bulkDows = new Set();
let undoSnap = null;
let selDate = null;

function load(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch(e){}
  if (!s || !s.workplaces) s = { workplaces: [], shifts: [], settings: { target: 100000, wall: 1030000, notify: false } };
  s.events ||= []; s.settings ||= {}; s.settings.holidays ??= true; s.settings.includeTentative ??= true;
  return s;
}
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); (window.SN?.onSave||[]).forEach(f=>{ try{ f(); }catch(e){ console.warn(e); } }); }
function snapshot(){ undoSnap = JSON.stringify({shifts:state.shifts, events:state.events}); }
function toast(msg, undo){
  const t=$('#toast'); t.innerHTML = esc(msg) + (undo ? '<button id="undoBtn">元に戻す</button>' : '');
  t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'), undo?4000:1800);
  if (undo) $('#undoBtn').onclick = ()=>{ if(!undoSnap) return; const u=JSON.parse(undoSnap); state.shifts=u.shifts; state.events=u.events; undoSnap=null; save(); render(); t.classList.add('hidden'); };
}

/* ---------- 祝日(日本) ---------- */
const holidayCache = {};
function holidays(y){
  if (holidayCache[y]) return holidayCache[y];
  const h = {};
  const add = (m,d,name)=>{ h[`${y}-${pad(m)}-${pad(d)}`] = name; };
  const nthMon = (m,n)=>{ const first = new Date(y,m-1,1).getDay(); return 1 + ((8-first)%7) + (n-1)*7; };
  add(1,1,'元日'); add(1,nthMon(1,2),'成人の日'); add(2,11,'建国記念の日'); add(2,23,'天皇誕生日');
  add(3, Math.floor(20.8431 + 0.242194*(y-1980) - Math.floor((y-1980)/4)), '春分の日');
  add(4,29,'昭和の日'); add(5,3,'憲法記念日'); add(5,4,'みどりの日'); add(5,5,'こどもの日');
  add(7,nthMon(7,3),'海の日'); add(8,11,'山の日'); add(9,nthMon(9,3),'敬老の日');
  add(9, Math.floor(23.2488 + 0.242194*(y-1980) - Math.floor((y-1980)/4)), '秋分の日');
  add(10,nthMon(10,2),'スポーツの日'); add(11,3,'文化の日'); add(11,23,'勤労感謝の日');
  // 振替休日・国民の休日
  const keys = Object.keys(h).sort();
  keys.forEach(k=>{ const d=parseD(k); if(d.getDay()===0){ let n=new Date(d); do { n.setDate(n.getDate()+1); } while(h[ymd(n)]); h[ymd(n)]='振替休日'; } });
  keys.forEach(k=>{ const d=parseD(k); const n=new Date(d); n.setDate(d.getDate()+2); if(h[ymd(n)]){ const mid=new Date(d); mid.setDate(d.getDate()+1); if(!h[ymd(mid)] && mid.getDay()!==0) h[ymd(mid)]='国民の休日'; } });
  return holidayCache[y] = h;
}

/* ---------- calc ---------- */
function wageAt(w, date){
  let wage = w.wage;
  (w.wageHistory||[]).filter(h=>h.from && h.from<=date && h.wage>0).sort((a,b)=>a.from<b.from?-1:1).forEach(h=>wage=h.wage);
  return wage;
}
function nightMinutes(sMin, eMin, ns, ne){
  const ranges = []; const nsM = ns*60, neM = ne*60;
  if (ns > ne) { ranges.push([nsM-24*60, neM]); ranges.push([nsM, 24*60+neM]); ranges.push([nsM+24*60, 48*60+neM]); }
  else { ranges.push([nsM, neM]); ranges.push([nsM+24*60, neM+24*60]); }
  let n = 0; for (const [a,b] of ranges) n += Math.max(0, Math.min(eMin,b) - Math.max(sMin,a)); return n;
}
function calcShift(s, w){
  if (!w) return {work:0,night:0,ot:0,pay:0,base:0,nightPay:0,otPay:0,trans:0,wage:0};
  let sMin = toMin(s.start), eMin = toMin(s.end);
  if (eMin <= sMin) eMin += 24*60;
  const brk = Number(s.breakMin ?? w.breakMin ?? 0) || 0;
  const total = Math.max(0, eMin - sMin);
  const work = Math.max(0, total - brk);
  let night = nightMinutes(sMin, eMin, w.nightStart ?? 22, w.nightEnd ?? 5);
  const brkFromNight = Math.max(0, brk - (total - night));
  night = Math.max(0, night - brkFromNight);
  const wage = wageAt(w, s.date);
  const ot = Math.max(0, work - (w.otAfterHours ?? 8) * 60);
  const base = wage * work / 60;
  const nightPay = wage * ((w.nightRate ?? 25)/100) * night / 60;
  const otPay = wage * ((w.otRate ?? 25)/100) * ot / 60;
  const trans = Number(s.transport ?? w.transport ?? 0) || 0;
  const r = Number(w.round || 1);
  const pay = Math.floor((base + nightPay + otPay) / r) * r + trans;
  return { work, night, ot, base, nightPay, otPay, trans, pay, wage };
}
const wp = id => state.workplaces.find(w=>w.id===id);
const counted = s => state.settings.includeTentative || !s.tentative;
const shiftsOn = date => state.shifts.filter(s=>s.date===date).sort((a,b)=>a.start<b.start?-1:1);
const eventsOn = date => state.events.filter(e=>e.date===date).sort((a,b)=>(a.start||'')<(b.start||'')?-1:1);

function period(w, y, m){
  const close = w.closingDay || 'end';
  if (close === 'end') return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`];
  const c = Number(close);
  const prev = new Date(y, m-2, 1); const pl = new Date(prev.getFullYear(), prev.getMonth()+1, 0).getDate();
  const fromD = Math.min(c,pl) >= pl ? new Date(y, m-1, 1) : new Date(prev.getFullYear(), prev.getMonth(), Math.min(c,pl)+1);
  const toD = new Date(y, m-1, Math.min(c, new Date(y, m, 0).getDate()));
  return [ymd(fromD), ymd(toD)];
}
function payDate(w, y, m){
  const d = new Date(y, m-1+Number(w.payMonthOffset ?? 1), 1);
  const pd = w.payDay || 'end'; const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(pd === 'end' ? last : Math.min(Number(pd), last));
  return d;
}
function sumRange(w, from, to){
  const res = { days:0, work:0, night:0, ot:0, base:0, nightPay:0, otPay:0, trans:0, pay:0, done:0, tent:0 };
  const today = ymd(new Date());
  state.shifts.filter(s=>s.wid===w.id && s.date>=from && s.date<=to).forEach(s=>{
    const c = calcShift(s, w);
    if (s.tentative) res.tent += c.pay;
    if (!counted(s)) return;
    res.days++; res.work+=c.work; res.night+=c.night; res.ot+=c.ot; res.base+=c.base; res.nightPay+=c.nightPay; res.otPay+=c.otPay; res.trans+=c.trans; res.pay+=c.pay;
    if (s.date <= today) res.done += c.pay;
  });
  return res;
}
// 次の給料日(全勤務先の中で一番近いもの)
function nextPayday(){
  const today = new Date(); today.setHours(0,0,0,0);
  let best = null;
  state.workplaces.filter(w=>!w.hidden).forEach(w=>{
    for (let k=-1;k<=3;k++){
      const d = new Date(today.getFullYear(), today.getMonth()+k, 1);
      const y=d.getFullYear(), m=d.getMonth()+1;
      const pd = payDate(w,y,m); if (pd < today) continue;
      const [from,to] = period(w,y,m); const r = sumRange(w,from,to);
      if (r.pay<=0 && k<3) continue; // 支払額0の給料日は飛ばす
      if (!best || pd < best.date) best = { date: pd, w, pay: r.pay };
      break;
    }
  });
  if (!best) return null;
  best.days = Math.round((best.date - today)/86400000);
  return best;
}

/* ---------- views ---------- */
function switchView(v){
  $$('.view').forEach(e=>e.classList.toggle('active', e.id==='view-'+v));
  $$('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  $('header.top').style.display = (v==='cal'||v==='pay') ? '' : 'none';
  render();
}
function render(){
  const y = cur.getFullYear(), m = cur.getMonth()+1;
  $('#monthTitle').textContent = `${y}年${m}月`;
  renderCalendar(); renderPay(); renderWork(); renderSettings();
  (window.SN?.onRender||[]).forEach(f=>{ try{ f(); }catch(e){ console.warn(e); } });
}

function renderCalendar(){
  const y = cur.getFullYear(), m = cur.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m+1, 0).getDate();
  const today = ymd(new Date());
  const visible = state.workplaces.filter(w=>!w.hidden);
  const hol = state.settings.holidays ? {...holidays(y-1), ...holidays(y), ...holidays(y+1)} : {};
  // summary
  let total=0, days=0, mins=0;
  const from=`${y}-${pad(m+1)}-01`, to=`${y}-${pad(m+1)}-${pad(daysIn)}`;
  state.shifts.filter(s=>s.date>=from&&s.date<=to&&counted(s)).forEach(s=>{ const w=wp(s.wid); if(!w||w.hidden) return; const c=calcShift(s,w); total+=c.pay; days++; mins+=c.work; });
  const tgt = state.settings.target||0;
  $('#summaryBar').innerHTML = `<div><b>${yen(total)}</b><small>今月の見込み</small></div><div><b>${days}日</b><small>${fmtH(mins)}</small></div><div><b>${tgt?Math.round(total/tgt*100)+'%':'-'}</b><small>目標 ${tgt?yen(tgt):'未設定'}</small></div>`;
  const np = nextPayday();
  $('#payInfo').innerHTML = np ? `<div>💰 次の給料日 <b>${np.date.getMonth()+1}/${np.date.getDate()}</b>(${np.days===0?'今日':'あと'+np.days+'日'}) ${esc(np.w.name)} <b>${yen(np.pay)}</b></div>` : '';
  // quick bar
  const qb = $('#quickBar'); qb.innerHTML='';
  const pats = [];
  visible.forEach(w=>(w.patterns||[]).forEach(p=>pats.push({w,p})));
  if (pats.length){
    const lbl=document.createElement('span'); lbl.className='muted'; lbl.style.alignSelf='center'; lbl.style.flex='none'; lbl.textContent='まとめて入力:'; qb.appendChild(lbl);
    pats.forEach(({w,p})=>{
      const b=document.createElement('button');
      b.innerHTML=`<span class="dot" style="background:${w.color}"></span>${esc(p.name)} ${shortT(p.start)}-${shortT(p.end)}`;
      const on = quickPattern && quickPattern.wid===w.id && quickPattern.pat===p;
      if(on) b.classList.add('on');
      b.onclick=()=>{ quickPattern = on ? null : {wid:w.id, pat:p}; bulkDows.clear(); renderCalendar(); if(!on) toast('日付をタップすると登録されます'); };
      qb.appendChild(b);
    });
  }
  const cp=document.createElement('button'); cp.textContent='先月をコピー'; cp.onclick=copyPrevMonth; qb.appendChild(cp);
  // bulk bar
  const bb = $('#bulkBar');
  if (quickPattern){
    const w=wp(quickPattern.wid), p=quickPattern.pat;
    bb.classList.remove('hidden');
    bb.innerHTML = `<div><b>${esc(w.name)} ${esc(p.name)} ${shortT(p.start)}-${shortT(p.end)}</b> を入力中。日付をタップ、または曜日を選んで一括:</div>
      <div class="dows">${[...DOW].map((d,i)=>`<button type="button" data-d="${i}" class="${bulkDows.has(i)?'on':''}">${d}</button>`).join('')}</div>
      <div class="btnrow"><button type="button" id="bulkApply" class="primary">選んだ曜日に一括追加</button><button type="button" id="bulkEnd">終了</button></div>`;
    bb.querySelectorAll('.dows button').forEach(b=>b.onclick=()=>{ const i=Number(b.dataset.d); bulkDows.has(i)?bulkDows.delete(i):bulkDows.add(i); b.classList.toggle('on'); });
    $('#bulkApply').onclick=()=>{
      if(!bulkDows.size){ toast('曜日を選んでください'); return; }
      snapshot(); let n=0;
      for(let d=1;d<=daysIn;d++){ const dt=new Date(y,m,d); if(!bulkDows.has(dt.getDay())) continue; const ds=ymd(dt);
        if(state.shifts.some(s=>s.date===ds&&s.wid===w.id&&s.start===p.start)) continue;
        state.shifts.push({id:uid(), wid:w.id, date:ds, start:p.start, end:p.end, breakMin:p.breakMin ?? w.breakMin ?? 0, memo:''}); n++; }
      save(); renderCalendar(); renderPay(); toast(`${n}件追加しました`, true);
    };
    $('#bulkEnd').onclick=()=>{ quickPattern=null; bulkDows.clear(); renderCalendar(); };
  } else { bb.classList.add('hidden'); bb.innerHTML=''; }
  // grid
  const cal = $('#calendar'); cal.innerHTML='';
  const cells = [];
  for (let i=0;i<startDow;i++) cells.push({d:new Date(y,m,i-startDow+1), other:true});
  for (let i=1;i<=daysIn;i++) cells.push({d:new Date(y,m,i)});
  while (cells.length%7) cells.push({d:new Date(y,m+1,cells.length-startDow-daysIn+1), other:true});
  cells.forEach(({d,other})=>{
    const ds = ymd(d), dow = d.getDay(), hn = hol[ds];
    const el = document.createElement('div');
    el.dataset.ds = ds; el.className = 'day' + (other?' other':'') + (ds===selDate?' sel':'') + (ds===today?' today':'') + (dow===0?' sun':dow===6?' sat':'') + (hn?' holiday':'');
    let html = `<div class="n">${d.getDate()}</div>` + (hn?`<div class="hn">${hn}</div>`:'');
    let dayPay = 0;
    shiftsOn(ds).forEach(s=>{
      const w = wp(s.wid); if(!w || w.hidden) return;
      const c = calcShift(s,w); if (counted(s)) dayPay += c.pay;
      html += `<span class="chip${s.tentative?' tent':''}" style="background:${w.color}">${shortT(s.start)}-${shortT(s.end)}${s.memo?`<small>${esc(s.memo)}</small>`:''}</span>`;
    });
    eventsOn(ds).forEach(e=>{ html += `<span class="chip ev" style="background:${e.color||'#8a8f9e'}">${e.allDay?'':shortT(e.start)+' '}${esc(e.title)}</span>`; });
    if (dayPay) html += `<span class="yen">${yen(dayPay)}</span>`;
    el.innerHTML = html;
    el.onclick = () => {
      if (quickPattern){ const w=wp(quickPattern.wid); const p=quickPattern.pat; snapshot();
        state.shifts.push({id:uid(), wid:w.id, date:ds, start:p.start, end:p.end, breakMin:p.breakMin ?? w.breakMin ?? 0, memo:''});
        save(); renderCalendar(); renderPay(); toast(`${d.getMonth()+1}/${d.getDate()} に ${p.name} を追加`, true); return; }
      openSheet(ds);
    };
    cal.appendChild(el);
  });
  if (selDate) { const inMonth = selDate.slice(0,7)===`${y}-${pad(m+1)}`; if (inMonth) openSheet(selDate, true); else closeSheet(); }
}
function copyPrevMonth(){
  const y=cur.getFullYear(), m=cur.getMonth();
  const pf=ymd(new Date(y,m-1,1)), pt=ymd(new Date(y,m,0));
  const src = state.shifts.filter(s=>s.date>=pf&&s.date<=pt);
  if(!src.length){ toast('先月のシフトがありません'); return; }
  if(!confirm(`先月のシフト${src.length}件を、同じ日付で今月にコピーしますか？`)) return;
  snapshot(); const daysIn=new Date(y,m+1,0).getDate(); let n=0;
  src.forEach(s=>{ const d=Number(s.date.slice(8)); if(d>daysIn) return; const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    if(state.shifts.some(x=>x.date===ds&&x.wid===s.wid&&x.start===s.start)) return;
    state.shifts.push({...s, id:uid(), date:ds}); n++; });
  save(); render(); toast(`${n}件コピーしました`, true);
}

/* ---------- day sheet ---------- */
function openSheet(ds, keep){
  keep = keep || selDate===ds; selDate = ds;
  const d = parseD(ds);
  const hn = state.settings.holidays ? holidays(d.getFullYear())[ds] : null;
  $('#sheetTitle').textContent = `${d.getMonth()+1}月${d.getDate()}日(${DOW[d.getDay()]})${hn?' '+hn:''}`;
  const body = $('#sheetBody'); body.innerHTML='';
  if (!state.workplaces.length){ body.innerHTML = `<div class="empty">まず勤務先を登録してください</div><button class="primary wide" id="goWork">勤務先を追加</button>`; $('#goWork').onclick=()=>{closeSheet();switchView('work');openWorkDlg();}; $('#dayPanel').classList.remove('hidden'); $$('.day').forEach(d=>d.classList.toggle('sel', d.dataset.ds===ds)); if(!keep) $('#dayPanel').scrollIntoView({behavior:'smooth',block:'nearest'}); return; }
  const list = shiftsOn(ds), evs = eventsOn(ds);
  list.forEach(s=>{
    const w = wp(s.wid); if(!w) return; const c = calcShift(s,w);
    const el = document.createElement('div'); el.className='shift-item'+(s.tentative?' tent':'');
    el.innerHTML = `<div class="bar" style="background:${w.color}"></div><div class="t"><b>${s.start}〜${s.end}</b> ${esc(w.name)}${s.tentative?'<span class="tag">希望</span>':''}<small>${fmtH(c.work)}${s.breakMin?` (休憩${s.breakMin}分)`:''}${c.night?` 深夜${fmtH(c.night)}`:''}${s.memo?` ／ ${esc(s.memo)}`:''}</small></div><div class="y">${yen(c.pay)}</div>`;
    el.onclick = () => openEdit(ds, s);
    body.appendChild(el);
  });
  evs.forEach(e=>{
    const el = document.createElement('div'); el.className='shift-item';
    el.innerHTML = `<div class="bar" style="background:${e.color||'#8a8f9e'}"></div><div class="t"><b>${e.allDay?'終日':e.start+'〜'+e.end}</b> ${esc(e.title)}<small>${esc(e.memo||'予定')}</small></div>`;
    el.onclick = () => openEvent(ds, e);
    body.appendChild(el);
  });
  if (!list.length && !evs.length) body.innerHTML = `<div class="empty">この日は何もありません</div>`;
  const pats = document.createElement('div'); pats.className='chips';
  state.workplaces.filter(w=>!w.hidden).forEach(w=>(w.patterns||[]).forEach(p=>{
    const b=document.createElement('button'); b.innerHTML=`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${w.color};margin-right:4px"></span>${esc(p.name)} ${shortT(p.start)}-${shortT(p.end)}`;
    b.onclick=()=>{ snapshot(); state.shifts.push({id:uid(), wid:w.id, date:ds, start:p.start, end:p.end, breakMin:p.breakMin ?? w.breakMin ?? 0, memo:''}); save(); openSheet(ds); renderCalendar(); renderPay(); toast('追加しました', true); };
    pats.appendChild(b);
  }));
  if (pats.children.length){ const h=document.createElement('p'); h.className='muted'; h.textContent='パターンから1タップで追加'; body.appendChild(h); body.appendChild(pats); }
  const row=document.createElement('div'); row.className='btnrow';
  const add = document.createElement('button'); add.className='primary'; add.textContent='＋ シフト'; add.onclick=()=>openEdit(ds,null);
  const ev = document.createElement('button'); ev.textContent='＋ 予定(休み・用事)'; ev.onclick=()=>openEvent(ds,null);
  row.appendChild(add); row.appendChild(ev); body.appendChild(row);
  $('#dayPanel').classList.remove('hidden'); $$('.day').forEach(d=>d.classList.toggle('sel', d.dataset.ds===ds)); if(!keep) $('#dayPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeSheet(){ selDate=null; $('#dayPanel').classList.add('hidden'); $$('.day.sel').forEach(d=>d.classList.remove('sel')); }

/* ---------- shift edit ---------- */
function openEdit(ds, s){
  const sel = $('#eWid'); sel.innerHTML = state.workplaces.filter(w=>!w.hidden || (s&&s.wid===w.id)).map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('');
  $('#editTitle').textContent = s ? 'シフトを編集' : 'シフトを追加';
  $('#eId').value = s?s.id:''; $('#eDate').value = ds;
  const last = !s && state.shifts.filter(x=>x.date<ds).sort((a,b)=>a.date<b.date?1:-1)[0];
  sel.value = s ? s.wid : (last && wp(last.wid) ? last.wid : state.workplaces[0].id);
  $('#eStart').value = s ? s.start : (last?last.start:'09:00');
  $('#eEnd').value = s ? s.end : (last?last.end:'17:00');
  const w = wp(sel.value);
  $('#eBreak').value = s ? (s.breakMin ?? '') : (last?(last.breakMin??''):(w?.breakMin ?? 0));
  $('#eTrans').value = s && s.transport!=null ? s.transport : '';
  $('#eMemo').value = s ? (s.memo||'') : '';
  $('#eTentative').checked = !!(s && s.tentative);
  $('#eDelete').style.display = s ? '' : 'none';
  renderEPatterns(); updatePreview();
  $('#editDlg').classList.remove('hidden');
}
function renderEPatterns(){
  const w = wp($('#eWid').value); const box = $('#ePatterns'); box.innerHTML='';
  $('#eTrans').placeholder = `勤務先の設定(${w?.transport||0}円)`;
  (w?.patterns||[]).forEach(p=>{ const b=document.createElement('button'); b.type='button'; b.textContent=`${p.name} ${shortT(p.start)}-${shortT(p.end)}`; b.onclick=()=>{ $('#eStart').value=p.start; $('#eEnd').value=p.end; $('#eBreak').value=p.breakMin ?? w.breakMin ?? 0; updatePreview(); }; box.appendChild(b); });
}
function readEdit(){
  return { id: $('#eId').value || uid(), wid: $('#eWid').value, date: $('#eDate').value, start: $('#eStart').value, end: $('#eEnd').value,
    breakMin: $('#eBreak').value===''? undefined : Number($('#eBreak').value), transport: $('#eTrans').value===''? undefined : Number($('#eTrans').value), memo: $('#eMemo').value.trim(), tentative: $('#eTentative').checked || undefined };
}
function updatePreview(){
  const s = readEdit(); const w = wp(s.wid); if(!w||!s.start||!s.end){ $('#ePreview').textContent=''; return; }
  const c = calcShift(s,w);
  $('#ePreview').innerHTML = `<b>${yen(c.pay)}</b> ／ 実働${fmtH(c.work)}${c.night?` ／ 深夜${fmtH(c.night)}`:''}${c.ot?` ／ 残業${fmtH(c.ot)}`:''}${c.trans?` ／ 交通費${yen(c.trans)}`:''} ／ 時給${yen(c.wage)}`;
}
$('#eWid').onchange = ()=>{ renderEPatterns(); const w=wp($('#eWid').value); $('#eBreak').value = w?.breakMin ?? 0; updatePreview(); };
['#eStart','#eEnd','#eBreak','#eTrans'].forEach(s=>$(s).oninput=updatePreview);
$('#editForm').onsubmit = e => {
  e.preventDefault(); const s = readEdit(); snapshot();
  const i = state.shifts.findIndex(x=>x.id===s.id);
  if (i>=0) state.shifts[i] = s; else state.shifts.push(s);
  save(); $('#editDlg').classList.add('hidden'); openSheet(s.date); renderCalendar(); renderPay(); toast('保存しました');
};
$('#eDelete').onclick = ()=>{ const id=$('#eId').value; snapshot(); state.shifts = state.shifts.filter(x=>x.id!==id); save(); $('#editDlg').classList.add('hidden'); openSheet($('#eDate').value); renderCalendar(); renderPay(); toast('削除しました', true); };
$('#editClose').onclick = ()=>$('#editDlg').classList.add('hidden');
$('#sheetClose').onclick = closeSheet;
['editDlg','eventDlg','workDlg','shareDlg'].forEach(id=>$('#'+id).onclick = e=>{ if(e.target.id===id) $('#'+id).classList.add('hidden'); });

/* ---------- event edit ---------- */
function openEvent(ds, ev){
  $('#eventTitle').textContent = ev ? '予定を編集' : '予定を追加';
  $('#vId').value = ev?ev.id:''; $('#vDate').value = ds;
  $('#vTitle').value = ev?ev.title:''; $('#vAllDay').checked = ev ? !!ev.allDay : true;
  $('#vStart').value = ev?.start||'10:00'; $('#vEnd').value = ev?.end||'12:00'; $('#vMemo').value = ev?.memo||'';
  setEvKind($('#vAllDay').checked?'all':'time');
  const col = ev?.color||EV_COLORS[0]; const cb=$('#vColors'); cb.innerHTML=''; EV_COLORS.forEach(c=>{ const sp=document.createElement('span'); sp.style.background=c; sp.dataset.c=c; if(c===col) sp.classList.add('on'); sp.onclick=()=>{ cb.querySelectorAll('span').forEach(x=>x.classList.remove('on')); sp.classList.add('on'); }; cb.appendChild(sp); });
  $('#vDelete').style.display = ev?'':'none';
  $('#eventDlg').classList.remove('hidden'); setTimeout(()=>$('#vTitle').focus(),50);
}
function setEvKind(k){ $('#vAllDay').checked = k==='all'; $('#vTimes').style.display = k==='all'?'none':''; $$('#vKind button').forEach(b=>b.classList.toggle('on', b.dataset.k===k)); }
$$('#vKind button').forEach(b=>b.onclick=()=>setEvKind(b.dataset.k));
$('#eventForm').onsubmit = e=>{
  e.preventDefault(); snapshot();
  const ev = { id: $('#vId').value||uid(), date: $('#vDate').value, title: $('#vTitle').value.trim(), allDay: $('#vAllDay').checked, start: $('#vStart').value, end: $('#vEnd').value, memo: $('#vMemo').value.trim(), color: $('#vColors .on')?.dataset.c||EV_COLORS[0] };
  const i = state.events.findIndex(x=>x.id===ev.id); if(i>=0) state.events[i]=ev; else state.events.push(ev);
  save(); $('#eventDlg').classList.add('hidden'); openSheet(ev.date); renderCalendar(); toast('保存しました');
};
$('#vDelete').onclick = ()=>{ snapshot(); const id=$('#vId').value; state.events=state.events.filter(x=>x.id!==id); save(); $('#eventDlg').classList.add('hidden'); openSheet($('#vDate').value); renderCalendar(); toast('削除しました', true); };
$('#eventClose').onclick = ()=>$('#eventDlg').classList.add('hidden');

/* ---------- share ---------- */
function monthText(kind){
  const y=cur.getFullYear(), m=cur.getMonth()+1;
  const from=`${y}-${pad(m)}-01`, to=`${y}-${pad(m)}-${pad(new Date(y,m,0).getDate())}`;
  const lines=[];
  if (kind==='off'){
    const evs = state.events.filter(e=>e.date>=from&&e.date<=to).sort((a,b)=>a.date<b.date?-1:1);
    lines.push(`${m}月の休み希望です。`); evs.forEach(e=>lines.push(`${mdw(e.date)} ${e.allDay?'終日':e.start+'〜'+e.end} ${e.title}`));
    if(!evs.length) lines.push('(予定が登録されていません)');
    return lines.join('\n');
  }
  const list = state.shifts.filter(s=>s.date>=from&&s.date<=to&&wp(s.wid)&&(kind==='wish'?s.tentative:true)).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.start<b.start?-1:1);
  const multi = new Set(list.map(s=>s.wid)).size>1;
  lines.push(kind==='wish' ? `${m}月の希望シフトです。よろしくお願いします。` : `${m}月のシフト`);
  list.forEach(s=>lines.push(`${mdw(s.date)} ${s.start}〜${s.end}${multi?' '+wp(s.wid).name:''}${s.memo?' '+s.memo:''}${kind==='month'&&s.tentative?'(希望)':''}`));
  if(!list.length) lines.push(kind==='wish'?'(「希望」にチェックしたシフトがありません)':'(シフトがありません)');
  if (kind==='month') lines.push(`計${list.length}日`);
  return lines.join('\n');
}
let shareText='';
async function doShare(text){
  shareText=text; $('#sharePreview').textContent=text;
  if (navigator.share) { try { await navigator.share({title:'シフト', text}); return; } catch(e){} }
  await copyText(text);
}
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast('コピーしました。LINEなどに貼り付けてください'); }catch{ toast('下の文章を長押しでコピーしてください'); } }
$('#shareBtn').onclick=()=>{ shareText=monthText('month'); $('#sharePreview').textContent=shareText; $('#shareDlg').classList.remove('hidden'); };
$('#shareClose').onclick=()=>$('#shareDlg').classList.add('hidden');
$('#shareMonth').onclick=()=>doShare(monthText('month'));
$('#shareWish').onclick=()=>doShare(monthText('wish'));
$('#shareOff').onclick=()=>doShare(monthText('off'));
$('#copyMonth').onclick=()=>copyText(shareText);
$('#shareIcs').onclick=()=>exportIcs();

/* ---------- pay view ---------- */
const r2 = n => Math.round(n*10)/10;
function renderPay(){
  const y = cur.getFullYear(), m = cur.getMonth()+1;
  const box = $('#payContent');
  if (!state.workplaces.length){ box.innerHTML = `<div class="empty">勤務先を登録するとここに給料が表示されます</div>`; return; }
  let grand = 0, grandDone = 0, grandTent = 0;
  const cards = [];
  state.workplaces.filter(w=>!w.hidden).forEach(w=>{
    const [from,to] = period(w,y,m); const r = sumRange(w,from,to); grand += r.pay; grandDone += r.done; grandTent += r.tent;
    const pd = payDate(w,y,m); const fd=parseD(from), td=parseD(to);
    const wt = Number(w.target||0);
    cards.push(`<div class="card"><h2><span class="dot" style="background:${w.color}"></span>${esc(w.name)} <span class="muted">${fd.getMonth()+1}/${fd.getDate()}〜${td.getMonth()+1}/${td.getDate()}締め ／ 支払 ${pd.getMonth()+1}/${pd.getDate()}</span></h2>
      <table class="detail">
        <tr><td>出勤 ${r.days}日 ／ 実働 ${fmtH(r.work)}</td><td>${yen(r.base)}</td></tr>
        ${r.night?`<tr><td>深夜手当 (${fmtH(r.night)})</td><td>${yen(r.nightPay)}</td></tr>`:''}
        ${r.ot?`<tr><td>残業手当 (${fmtH(r.ot)})</td><td>${yen(r.otPay)}</td></tr>`:''}
        ${r.trans?`<tr><td>交通費 (${r.days}日分)</td><td>${yen(r.trans)}</td></tr>`:''}
        <tr class="total"><td>合計</td><td>${yen(r.pay)}</td></tr>
      </table>
      ${wt?`<div class="bar-wrap"><i class="${r.pay>=wt?'ok':''}" style="width:${Math.min(100,r2(r.pay/wt*100))}%"></i></div><div class="muted">この勤務先の目標 ${yen(wt)}${r.pay>=wt?' 達成！':' まで あと '+yen(wt-r.pay)}</div>`:''}
      ${r.pay!==r.done?`<p class="muted">うち今日までの確定分 ${yen(r.done)}</p>`:''}
      ${r.tent?`<p class="muted">希望(未確定)分 ${yen(r.tent)} ${state.settings.includeTentative?'を含む':'は含まず'}</p>`:''}</div>`);
  });
  const tgt = state.settings.target||0;
  const pct = tgt ? Math.min(100, r2(grand/tgt*100)) : 0;
  let html = `<div class="card"><div class="muted">${m}月分の合計(全勤務先)</div><div class="big">${yen(grand)}</div>
    ${tgt?`<div class="bar-wrap"><i class="${grand>=tgt?'ok':''}" style="width:${pct}%"></i></div><div class="muted">目標 ${yen(tgt)} まで ${grand>=tgt?'達成！':'あと '+yen(tgt-grand)}</div>`:''}
    ${grand!==grandDone?`<div class="muted">今日までの確定分 ${yen(grandDone)} ／ これからの予定 ${yen(grand-grandDone)}</div>`:''}</div>`;
  html += cards.join('');
  const wall = Number(state.settings.wall||0);
  let yearTotal = 0; const yf=`${y}-01-01`, yt=`${y}-12-31`;
  state.shifts.filter(s=>s.date>=yf&&s.date<=yt&&counted(s)).forEach(s=>{ yearTotal += calcShift(s,wp(s.wid)).pay; });
  const wpct = wall ? Math.min(100, r2(yearTotal/wall*100)) : 0;
  const monthsLeft = (y===new Date().getFullYear()) ? 12-new Date().getMonth() : 12;
  html += `<div class="card"><h2>${y}年の年収見込み</h2><div class="big">${yen(yearTotal)}</div>
    ${wall?`<div class="bar-wrap"><i class="${yearTotal>=wall?'over':wpct>=85?'warn':''}" style="width:${wpct}%"></i></div><div class="muted">${yen(wall)}の壁まで ${yearTotal>=wall?'<b style="color:var(--danger)">超えています</b>':'あと '+yen(wall-yearTotal)+(y===new Date().getFullYear()?` (残り${monthsLeft}か月、月${yen((wall-yearTotal)/monthsLeft)}まで)`:'')}</div>`:''}
    <p class="muted">交通費も合計に含めています(非課税の交通費は壁の計算から除ける場合があります)。</p></div>`;
  box.innerHTML = html;
}

/* ---------- workplaces ---------- */
function renderWork(){
  const box = $('#workList'); box.innerHTML='';
  if (!state.workplaces.length){ box.innerHTML = `<div class="empty">勤務先を追加すると、シフト入力と給料計算ができます</div>`; return; }
  state.workplaces.forEach((w,i)=>{
    const el = document.createElement('div'); el.className='card work-item'+(w.hidden?' hidden-w':'');
    el.innerHTML = `<span style="width:14px;height:14px;border-radius:50%;background:${w.color};flex:none"></span><div class="t"><b>${esc(w.name)}</b><small>時給${yen(wageAt(w,ymd(new Date())))} ／ ${w.closingDay==='end'?'月末':w.closingDay+'日'}締め ／ ${(w.patterns||[]).length}パターン${w.hidden?' ／ 非表示':''}</small></div>
      <div class="ops"><button data-op="up" ${i===0?'disabled':''}>↑</button><button data-op="down" ${i===state.workplaces.length-1?'disabled':''}>↓</button><button data-op="hide">${w.hidden?'表示':'隠す'}</button></div>`;
    el.querySelector('.t').onclick = ()=>openWorkDlg(w);
    el.querySelectorAll('.ops button').forEach(b=>b.onclick=()=>{
      const op=b.dataset.op;
      if(op==='up'){ [state.workplaces[i-1],state.workplaces[i]]=[state.workplaces[i],state.workplaces[i-1]]; }
      if(op==='down'){ [state.workplaces[i+1],state.workplaces[i]]=[state.workplaces[i],state.workplaces[i+1]]; }
      if(op==='hide'){ w.hidden=!w.hidden; }
      save(); render();
    });
    box.appendChild(el);
  });
}
function fillDaySelect(sel){ sel.innerHTML = '<option value="end">月末</option>' + Array.from({length:28},(_,i)=>`<option value="${i+1}">${i+1}日</option>`).join(''); }
let editingW = null;
function openWorkDlg(w){
  editingW = w || null;
  $('#workTitle').textContent = w ? '勤務先を編集' : '勤務先を追加';
  $('#wId').value = w?w.id:''; $('#wName').value = w?w.name:''; $('#wWage').value = w?w.wage:''; $('#wTrans').value = w?(w.transport||0):0;
  fillDaySelect($('#wClose')); fillDaySelect($('#wPay'));
  $('#wClose').value = w?(w.closingDay||'end'):'end'; $('#wPay').value = w?(w.payDay||'end'):'25'; $('#wPayMonth').value = w?(w.payMonthOffset ?? 1):1;
  $('#wNight').value = w?(w.nightRate ?? 25):25; $('#wNightS').value = w?(w.nightStart ?? 22):22; $('#wNightE').value = w?(w.nightEnd ?? 5):5;
  $('#wOt').value = w?(w.otRate ?? 25):25; $('#wOtAfter').value = w?(w.otAfterHours ?? 8):8;
  $('#wBreak').value = w?(w.breakMin ?? 0):0; $('#wRound').value = w?(w.round||1):1; $('#wTarget').value = w?(w.target||''):'';
  const used = new Set(state.workplaces.filter(x=>!w||x.id!==w.id).map(x=>x.color));
  const col = w?w.color:(COLORS.find(c=>!used.has(c))||COLORS[0]);
  const cb = $('#wColors'); cb.innerHTML=''; COLORS.forEach(c=>{ const s=document.createElement('span'); s.style.background=c; if(c===col) s.classList.add('on'); s.dataset.c=c; s.onclick=()=>{ cb.querySelectorAll('span').forEach(x=>x.classList.remove('on')); s.classList.add('on'); }; cb.appendChild(s); });
  $('#wWageHist').innerHTML=''; (w?(w.wageHistory||[]):[]).forEach(h=>addWageRow(h.from,h.wage));
  $('#wPatterns').innerHTML=''; (w?(w.patterns||[]):[{name:'通常',start:'09:00',end:'17:00',breakMin:60}]).forEach(p=>addPatRow(p));
  $('#wDelete').style.display = w?'':'none';
  $('#workDlg').classList.remove('hidden');
}
function addWageRow(from='',wage=''){
  const r=document.createElement('div'); r.className='histrow';
  r.innerHTML=`<label>この日から<input type="date" class="hFrom" value="${from}"></label><label>時給<input type="number" class="hWage" value="${wage}" inputmode="numeric"></label><button type="button">✕</button>`;
  r.querySelector('button').onclick=()=>r.remove(); $('#wWageHist').appendChild(r);
}
function addPatRow(p={name:'',start:'09:00',end:'17:00',breakMin:''}){
  const r=document.createElement('div'); r.className='patrow';
  r.innerHTML=`<label>名前<input type="text" class="pName" value="${esc(p.name)}" placeholder="早番"></label><label>開始<input type="time" class="pS" value="${p.start}"></label><label>終了<input type="time" class="pE" value="${p.end}"></label><button type="button">✕</button>
    <label style="grid-column:1/3">休憩(分)<input type="number" class="pB" value="${p.breakMin ?? ''}" placeholder="標準" inputmode="numeric"></label>`;
  r.querySelector('button').onclick=()=>r.remove(); $('#wPatterns').appendChild(r);
}
$('#wAddWage').onclick=()=>addWageRow();
$('#wAddPattern').onclick=()=>addPatRow();
$('#addWork').onclick=()=>openWorkDlg(null);
$('#workClose').onclick=()=>$('#workDlg').classList.add('hidden');
$('#workForm').onsubmit=e=>{
  e.preventDefault();
  const w = editingW || { id: uid() };
  w.name=$('#wName').value.trim(); w.color=$('#wColors .on')?.dataset.c||COLORS[0];
  w.wage=Number($('#wWage').value)||0; w.transport=Number($('#wTrans').value)||0;
  w.closingDay=$('#wClose').value; w.payDay=$('#wPay').value; w.payMonthOffset=Number($('#wPayMonth').value);
  w.nightRate=Number($('#wNight').value); w.nightStart=Number($('#wNightS').value); w.nightEnd=Number($('#wNightE').value);
  w.otRate=Number($('#wOt').value); w.otAfterHours=Number($('#wOtAfter').value); w.breakMin=Number($('#wBreak').value)||0; w.round=Number($('#wRound').value)||1; w.target=Number($('#wTarget').value)||0;
  w.wageHistory=[...$('#wWageHist .histrow')].map(r=>({from:r.querySelector('.hFrom').value, wage:Number(r.querySelector('.hWage').value)})).filter(h=>h.from&&h.wage>0);
  w.patterns=[...$('#wPatterns .patrow')].map(r=>({name:r.querySelector('.pName').value.trim()||'シフト', start:r.querySelector('.pS').value, end:r.querySelector('.pE').value, breakMin:r.querySelector('.pB').value===''?undefined:Number(r.querySelector('.pB').value)})).filter(p=>p.start&&p.end);
  if(!editingW) state.workplaces.push(w);
  save(); $('#workDlg').classList.add('hidden'); render(); toast('保存しました');
  if (state.workplaces.length===1 && !state.shifts.length) { switchView('cal'); setTimeout(()=>toast('カレンダーの日付をタップしてシフトを入れましょう'),400); }
};
$('#wDelete').onclick=()=>{ if(!editingW) return; const n=state.shifts.filter(s=>s.wid===editingW.id).length; if(!confirm(`「${editingW.name}」を削除しますか？\n登録済みのシフト${n}件も削除されます。`)) return; state.shifts=state.shifts.filter(s=>s.wid!==editingW.id); state.workplaces=state.workplaces.filter(w=>w.id!==editingW.id); save(); $('#workDlg').classList.add('hidden'); render(); };

/* ---------- settings ---------- */
function renderSettings(){
  $('#setTarget').value = state.settings.target||'';
  $('#setWall').value = String(state.settings.wall ?? 1030000);
  $('#setNotify').checked = !!state.settings.notify;
  $('#setHolidays').checked = !!state.settings.holidays;
  $('#setIncludeTentative').checked = !!state.settings.includeTentative;
}
$('#setTarget').onchange = e=>{ state.settings.target=Number(e.target.value)||0; save(); render(); };
$('#setWall').onchange = e=>{ state.settings.wall=Number(e.target.value); save(); render(); };
$('#setHolidays').onchange = e=>{ state.settings.holidays=e.target.checked; save(); render(); };
$('#setIncludeTentative').onchange = e=>{ state.settings.includeTentative=e.target.checked; save(); render(); };
$('#setNotify').onchange = async e=>{ state.settings.notify=e.target.checked; save(); if(e.target.checked && 'Notification' in window && Notification.permission==='default') await Notification.requestPermission(); checkTomorrow(true); };
$('#exportJson').onclick=()=>download(`shift-backup-${ymd(new Date())}.json`, JSON.stringify(state,null,1), 'application/json');
$('#importJson').onclick=()=>$('#importFile').click();
$('#importFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader(); fr.onload=()=>{ try{ const s=JSON.parse(fr.result); if(!s.workplaces||!s.shifts) throw 0; if(!confirm('今のデータを上書きして読み込みますか？')) return; localStorage.setItem(KEY, JSON.stringify(s)); state=load(); render(); toast('読み込みました'); }catch{ alert('ファイルの形式が違います'); } }; fr.readAsText(f); e.target.value=''; };
function exportIcs(){
  const f=(dt,t)=>`${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${t.replace(':','')}00`;
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//shiftnote//JP','X-WR-CALNAME:シフト手帳'];
  state.shifts.forEach(s=>{ const w=wp(s.wid); if(!w) return; const d=parseD(s.date); const e=new Date(d); if(toMin(s.end)<=toMin(s.start)) e.setDate(e.getDate()+1);
    lines.push('BEGIN:VEVENT',`UID:${s.id}@shiftnote`,`DTSTART:${f(d,s.start)}`,`DTEND:${f(e,s.end)}`,`SUMMARY:${w.name}${s.tentative?'(希望)':''}${s.memo?' '+s.memo:''}`,`DESCRIPTION:${yen(calcShift(s,w).pay)}`,'END:VEVENT'); });
  state.events.forEach(v=>{ const d=parseD(v.date);
    if (v.allDay){ const n=new Date(d); n.setDate(d.getDate()+1); const g=x=>`${x.getFullYear()}${pad(x.getMonth()+1)}${pad(x.getDate())}`; lines.push('BEGIN:VEVENT',`UID:${v.id}@shiftnote`,`DTSTART;VALUE=DATE:${g(d)}`,`DTEND;VALUE=DATE:${g(n)}`,`SUMMARY:${v.title}`,'END:VEVENT'); }
    else lines.push('BEGIN:VEVENT',`UID:${v.id}@shiftnote`,`DTSTART:${f(d,v.start)}`,`DTEND:${f(d,v.end)}`,`SUMMARY:${v.title}`,'END:VEVENT'); });
  lines.push('END:VCALENDAR');
  download('shift.ics', lines.join('\r\n'), 'text/calendar');
}
$('#exportIcs').onclick=exportIcs;
$('#resetAll').onclick=()=>{ if(!confirm('すべてのデータを削除しますか？')) return; if(!confirm('本当に削除しますか？元に戻せません。')) return; localStorage.removeItem(KEY); state=load(); render(); };
function download(name, text, type){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
}

/* ---------- 明日の通知 ---------- */
function checkTomorrow(force){
  if(!state.settings.notify) return;
  const t=new Date(); t.setDate(t.getDate()+1); const ds=ymd(t);
  const list=shiftsOn(ds).filter(s=>wp(s.wid));
  const k='shiftnote.notified'; if(!force && localStorage.getItem(k)===ds) return;
  if(!list.length) return;
  localStorage.setItem(k, ds);
  const msg = list.map(s=>`${wp(s.wid).name} ${s.start}〜${s.end}`).join(' / ');
  if('Notification' in window && Notification.permission==='granted') new Notification('明日のシフト', {body: msg}); else toast('明日: '+msg);
}

/* ---------- nav ---------- */
$$('.tabs button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#prevMonth').onclick=()=>{cur.setMonth(cur.getMonth()-1);render();};
$('#nextMonth').onclick=()=>{cur.setMonth(cur.getMonth()+1);render();};
$('#todayBtn').onclick=()=>{cur=new Date();cur.setDate(1);render();};
let tx=null; $('#calendar').addEventListener('touchstart',e=>tx=e.touches[0].clientX,{passive:true});
$('#calendar').addEventListener('touchend',e=>{ if(tx==null) return; const dx=e.changedTouches[0].clientX-tx; tx=null; if(Math.abs(dx)>70){ cur.setMonth(cur.getMonth()+(dx<0?1:-1)); render(); } });
document.addEventListener('backbutton', ()=>{ $$('.sheet:not(.hidden)').forEach(s=>s.classList.add('hidden')); });

window.SN = { get state(){ return state; }, set state(v){ state=v; }, save, render, calcShift, wp, period, payDate, sumRange, toast, yen, ymd, pad, parseD, shiftsOn, fmtH, wageAt, counted, cur:()=>cur, switchView, esc, onSave:[], onRender:[] };
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(()=>{});
render();
if (!state.workplaces.length) { switchView('work'); setTimeout(()=>toast('まず勤務先を登録しましょう'), 300); }
checkTomorrow(false);
})();
