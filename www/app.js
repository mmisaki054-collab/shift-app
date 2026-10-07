/* シフト手帳 - app.js */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const COLORS = ['#2f6fed','#e0433a','#1fa864','#e8a300','#8e44ad','#16a085','#e67e22','#ff5c8a','#607d8b','#795548'];
const KEY = 'shiftnote.v1';
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const fmtH = min => { const h = Math.floor(min/60), m = min%60; return m ? `${h}時間${m}分` : `${h}時間`; };
const shortT = t => t.replace(/^0/,'').replace(':00','');

/* ---------- state ---------- */
let state = load();
let cur = new Date(); cur.setDate(1);
let quickPattern = null; // {wid, pat}
let selDate = null;

function load(){
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.workplaces) return s; } catch(e){}
  return { workplaces: [], shifts: [], settings: { target: 100000, wall: 1030000, notify: false } };
}
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),1800); }

/* ---------- calc ---------- */
function wageAt(w, date){
  let wage = w.wage;
  (w.wageHistory||[]).filter(h=>h.from && h.from<=date && h.wage>0).sort((a,b)=>a.from<b.from?-1:1).forEach(h=>wage=h.wage);
  return wage;
}
// 深夜帯の分数を計算
function nightMinutes(sMin, eMin, ns, ne){
  // ns..ne (e.g. 22..5) -> ranges within 0..48h
  const ranges = [];
  const nsM = ns*60, neM = ne*60;
  if (ns > ne) { ranges.push([nsM, 24*60+neM]); ranges.push([nsM-24*60, neM]); ranges.push([nsM+24*60, 48*60+neM]); }
  else { ranges.push([nsM, neM]); ranges.push([nsM+24*60, neM+24*60]); }
  let n = 0;
  for (const [a,b] of ranges) n += Math.max(0, Math.min(eMin,b) - Math.max(sMin,a));
  return n;
}
function calcShift(s, w){
  if (!w) return {work:0,night:0,ot:0,pay:0,base:0,nightPay:0,otPay:0,trans:0};
  let sMin = toMin(s.start), eMin = toMin(s.end);
  if (eMin <= sMin) eMin += 24*60; // 日またぎ
  const brk = Number(s.breakMin ?? w.breakMin ?? 0) || 0;
  const total = Math.max(0, eMin - sMin);
  const work = Math.max(0, total - brk);
  // 深夜分: 休憩は深夜以外から先に引く(一般的な扱い)
  let night = nightMinutes(sMin, eMin, w.nightStart ?? 22, w.nightEnd ?? 5);
  const dayPart = total - night;
  const brkFromNight = Math.max(0, brk - dayPart);
  night = Math.max(0, night - brkFromNight);
  const wage = wageAt(w, s.date);
  const otAfter = (w.otAfterHours ?? 8) * 60;
  const ot = Math.max(0, work - otAfter);
  const base = wage * work / 60;
  const nightPay = wage * ((w.nightRate ?? 25)/100) * night / 60;
  const otPay = wage * ((w.otRate ?? 25)/100) * ot / 60;
  const trans = Number(s.transport ?? w.transport ?? 0) || 0;
  const r = Number(w.round || 1);
  const pay = Math.floor((base + nightPay + otPay) / r) * r + trans;
  return { work, night, ot, base, nightPay, otPay, trans, pay, wage };
}
const wp = id => state.workplaces.find(w=>w.id===id);
const shiftsOn = date => state.shifts.filter(s=>s.date===date).sort((a,b)=>a.start<b.start?-1:1);

// 締め期間: 勤務先wの「n月分」= 締め日に基づく期間 [from,to]
function period(w, y, m){ // m: 1-12 (締め月)
  const close = w.closingDay || 'end';
  if (close === 'end') { const last = new Date(y, m, 0).getDate(); return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(last)}`]; }
  const c = Number(close);
  const prev = new Date(y, m-2, 1); const pl = new Date(prev.getFullYear(), prev.getMonth()+1, 0).getDate();
  const fromD = Math.min(c,pl) >= pl ? new Date(y, m-1, 1) : new Date(prev.getFullYear(), prev.getMonth(), Math.min(c,pl)+1);
  const toD = new Date(y, m-1, Math.min(c, new Date(y, m, 0).getDate()));
  return [ymd(fromD), ymd(toD)];
}
function payDate(w, y, m){
  const off = Number(w.payMonthOffset ?? 1);
  const d = new Date(y, m-1+off, 1);
  const pd = w.payDay || 'end';
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(pd === 'end' ? last : Math.min(Number(pd), last));
  return d;
}
function sumRange(w, from, to){
  const res = { days:0, work:0, night:0, ot:0, base:0, nightPay:0, otPay:0, trans:0, pay:0, done:0 };
  const today = ymd(new Date());
  state.shifts.filter(s=>s.wid===w.id && s.date>=from && s.date<=to).forEach(s=>{
    const c = calcShift(s, w);
    res.days++; res.work+=c.work; res.night+=c.night; res.ot+=c.ot; res.base+=c.base; res.nightPay+=c.nightPay; res.otPay+=c.otPay; res.trans+=c.trans; res.pay+=c.pay;
    if (s.date <= today) res.done += c.pay;
  });
  return res;
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
}

function renderCalendar(){
  const y = cur.getFullYear(), m = cur.getMonth();
  const first = new Date(y, m, 1), startDow = first.getDay();
  const daysIn = new Date(y, m+1, 0).getDate();
  const today = ymd(new Date());
  const visible = state.workplaces.filter(w=>!w.hidden);
  // summary (暦月)
  let total=0, days=0, mins=0;
  const from=`${y}-${pad(m+1)}-01`, to=`${y}-${pad(m+1)}-${pad(daysIn)}`;
  state.shifts.filter(s=>s.date>=from&&s.date<=to).forEach(s=>{ const c=calcShift(s,wp(s.wid)); total+=c.pay; days++; mins+=c.work; });
  const tgt = state.settings.target||0;
  $('#summaryBar').innerHTML = `<div><b>${yen(total)}</b><small>今月の見込み</small></div><div><b>${days}日</b><small>${fmtH(mins)}</small></div><div><b>${tgt?Math.round(total/tgt*100)+'%':'-'}</b><small>目標 ${tgt?yen(tgt):'未設定'}</small></div>`;
  // quick bar
  const qb = $('#quickBar'); qb.innerHTML='';
  const pats = [];
  visible.forEach(w=>(w.patterns||[]).forEach(p=>pats.push({w,p})));
  if (pats.length){
    const lbl=document.createElement('span'); lbl.className='muted'; lbl.style.alignSelf='center'; lbl.textContent='まとめて入力:'; qb.appendChild(lbl);
    pats.forEach(({w,p})=>{
      const b=document.createElement('button');
      b.innerHTML=`<span class="dot" style="background:${w.color}"></span>${p.name} ${shortT(p.start)}-${shortT(p.end)}`;
      const on = quickPattern && quickPattern.wid===w.id && quickPattern.pat===p;
      if(on) b.classList.add('on');
      b.onclick=()=>{ quickPattern = on ? null : {wid:w.id, pat:p}; renderCalendar(); if(!on) toast('日付をタップすると登録されます'); };
      qb.appendChild(b);
    });
    if (quickPattern){ const x=document.createElement('button'); x.textContent='終了'; x.onclick=()=>{quickPattern=null;renderCalendar();}; qb.appendChild(x); }
  }
  // grid
  const cal = $('#calendar'); cal.innerHTML='';
  const cells = [];
  for (let i=0;i<startDow;i++){ const d=new Date(y,m,i-startDow+1); cells.push({d, other:true}); }
  for (let i=1;i<=daysIn;i++) cells.push({d:new Date(y,m,i)});
  while (cells.length%7) { const d=new Date(y,m+1,cells.length-startDow-daysIn+1); cells.push({d,other:true}); }
  cells.forEach(({d,other})=>{
    const ds = ymd(d), dow = d.getDay();
    const el = document.createElement('div');
    el.className = 'day' + (other?' other':'') + (ds===today?' today':'') + (dow===0?' sun':dow===6?' sat':'');
    let html = `<div class="n">${d.getDate()}</div>`;
    let dayPay = 0;
    shiftsOn(ds).forEach(s=>{
      const w = wp(s.wid); if(!w || w.hidden) return;
      const c = calcShift(s,w); dayPay += c.pay;
      html += `<span class="chip" style="background:${w.color}">${shortT(s.start)}-${shortT(s.end)}${s.memo?`<small>${esc(s.memo)}</small>`:''}</span>`;
    });
    if (dayPay) html += `<span class="yen">${yen(dayPay)}</span>`;
    el.innerHTML = html;
    el.onclick = () => {
      if (quickPattern){ const w=wp(quickPattern.wid); const p=quickPattern.pat;
        state.shifts.push({id:uid(), wid:w.id, date:ds, start:p.start, end:p.end, breakMin:p.breakMin ?? w.breakMin ?? 0, memo:''});
        save(); renderCalendar(); toast(`${d.getMonth()+1}/${d.getDate()} に ${p.name} を追加`); return; }
      openSheet(ds);
    };
    cal.appendChild(el);
  });
}
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- day sheet ---------- */
function openSheet(ds){
  selDate = ds;
  const d = parseD(ds);
  $('#sheetTitle').textContent = `${d.getMonth()+1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
  const body = $('#sheetBody'); body.innerHTML='';
  const list = shiftsOn(ds);
  if (!state.workplaces.length){ body.innerHTML = `<div class="empty">まず勤務先を登録してください</div><button class="primary wide" id="goWork">勤務先を追加</button>`; $('#goWork').onclick=()=>{closeSheet();switchView('work');openWorkDlg();}; $('#sheet').classList.remove('hidden'); return; }
  list.forEach(s=>{
    const w = wp(s.wid); if(!w) return; const c = calcShift(s,w);
    const el = document.createElement('div'); el.className='shift-item';
    el.innerHTML = `<div class="bar" style="background:${w.color}"></div><div class="t"><b>${s.start}〜${s.end}</b> ${esc(w.name)}<small>${fmtH(c.work)}${s.breakMin?` (休憩${s.breakMin}分)`:''}${c.night?` 深夜${fmtH(c.night)}`:''}${s.memo?` ／ ${esc(s.memo)}`:''}</small></div><div class="y">${yen(c.pay)}</div>`;
    el.onclick = () => openEdit(ds, s);
    body.appendChild(el);
  });
  if (!list.length) body.innerHTML = `<div class="empty">シフトはありません</div>`;
  // quick add via patterns
  const pats = document.createElement('div'); pats.className='chips';
  state.workplaces.filter(w=>!w.hidden).forEach(w=>(w.patterns||[]).forEach(p=>{
    const b=document.createElement('button'); b.innerHTML=`<span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${w.color};margin-right:4px"></span>${esc(p.name)} ${shortT(p.start)}-${shortT(p.end)}`;
    b.onclick=()=>{ state.shifts.push({id:uid(), wid:w.id, date:ds, start:p.start, end:p.end, breakMin:p.breakMin ?? w.breakMin ?? 0, memo:''}); save(); openSheet(ds); renderCalendar(); toast('追加しました'); };
    pats.appendChild(b);
  }));
  if (pats.children.length){ const h=document.createElement('p'); h.className='muted'; h.textContent='パターンから1タップで追加'; body.appendChild(h); body.appendChild(pats); }
  const add = document.createElement('button'); add.className='primary wide'; add.textContent='＋ 時間を指定して追加'; add.onclick=()=>openEdit(ds,null);
  body.appendChild(add);
  $('#sheet').classList.remove('hidden');
}
function closeSheet(){ $('#sheet').classList.add('hidden'); }

/* ---------- shift edit ---------- */
function openEdit(ds, s){
  const sel = $('#eWid'); sel.innerHTML = state.workplaces.filter(w=>!w.hidden || (s&&s.wid===w.id)).map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('');
  $('#editTitle').textContent = s ? 'シフトを編集' : 'シフトを追加';
  $('#eId').value = s?s.id:''; $('#eDate').value = ds;
  const last = !s && state.shifts.filter(x=>x.date<ds).sort((a,b)=>a.date<b.date?1:-1)[0];
  sel.value = s ? s.wid : (last ? last.wid : state.workplaces[0].id);
  $('#eStart').value = s ? s.start : (last?last.start:'09:00');
  $('#eEnd').value = s ? s.end : (last?last.end:'17:00');
  const w = wp(sel.value);
  $('#eBreak').value = s ? (s.breakMin ?? '') : (w?.breakMin ?? 0);
  $('#eTrans').value = s && s.transport!=null ? s.transport : '';
  $('#eTrans').placeholder = `勤務先の設定(${w?.transport||0}円)`;
  $('#eMemo').value = s ? (s.memo||'') : '';
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
    breakMin: $('#eBreak').value===''? undefined : Number($('#eBreak').value), transport: $('#eTrans').value===''? undefined : Number($('#eTrans').value), memo: $('#eMemo').value.trim() };
}
function updatePreview(){
  const s = readEdit(); const w = wp(s.wid); if(!w||!s.start||!s.end){ $('#ePreview').textContent=''; return; }
  const c = calcShift(s,w);
  $('#ePreview').innerHTML = `<b>${yen(c.pay)}</b> ／ 実働${fmtH(c.work)}${c.night?` ／ 深夜${fmtH(c.night)}`:''}${c.ot?` ／ 残業${fmtH(c.ot)}`:''}${c.trans?` ／ 交通費${yen(c.trans)}`:''} ／ 時給${yen(c.wage)}`;
}
$('#eWid').onchange = ()=>{ renderEPatterns(); const w=wp($('#eWid').value); $('#eBreak').value = w?.breakMin ?? 0; updatePreview(); };
['#eStart','#eEnd','#eBreak','#eTrans'].forEach(s=>$(s).oninput=updatePreview);
$('#editForm').onsubmit = e => {
  e.preventDefault(); const s = readEdit();
  const i = state.shifts.findIndex(x=>x.id===s.id);
  if (i>=0) state.shifts[i] = s; else state.shifts.push(s);
  save(); $('#editDlg').classList.add('hidden'); openSheet(s.date); renderCalendar(); renderPay(); toast('保存しました');
};
$('#eDelete').onclick = ()=>{ const id=$('#eId').value; if(!confirm('このシフトを削除しますか？')) return; state.shifts = state.shifts.filter(x=>x.id!==id); save(); $('#editDlg').classList.add('hidden'); openSheet($('#eDate').value); renderCalendar(); renderPay(); };
$('#editClose').onclick = ()=>$('#editDlg').classList.add('hidden');
$('#sheetClose').onclick = closeSheet;
$('#sheet').onclick = e=>{ if(e.target.id==='sheet') closeSheet(); };
$('#editDlg').onclick = e=>{ if(e.target.id==='editDlg') $('#editDlg').classList.add('hidden'); };
$('#workDlg').onclick = e=>{ if(e.target.id==='workDlg') $('#workDlg').classList.add('hidden'); };

/* ---------- pay view ---------- */
function renderPay(){
  const y = cur.getFullYear(), m = cur.getMonth()+1;
  const box = $('#payContent');
  if (!state.workplaces.length){ box.innerHTML = `<div class="empty">勤務先を登録するとここに給料が表示されます</div>`; return; }
  let html = '';
  let grand = 0, grandDone = 0;
  const cards = [];
  state.workplaces.filter(w=>!w.hidden).forEach(w=>{
    const [from,to] = period(w,y,m); const r = sumRange(w,from,to); grand += r.pay; grandDone += r.done;
    const pd = payDate(w,y,m);
    const fd=parseD(from), td=parseD(to);
    cards.push(`<div class="card"><h2><span class="dot" style="background:${w.color}"></span>${esc(w.name)} <span class="muted">${fd.getMonth()+1}/${fd.getDate()}〜${td.getMonth()+1}/${td.getDate()}締め ／ 支払 ${pd.getMonth()+1}/${pd.getDate()}</span></h2>
      <table class="detail">
        <tr><td>出勤 ${r.days}日 ／ 実働 ${fmtH(r.work)}</td><td>${yen(r.base)}</td></tr>
        ${r.night?`<tr><td>深夜手当 (${fmtH(r.night)})</td><td>${yen(r.nightPay)}</td></tr>`:''}
        ${r.ot?`<tr><td>残業手当 (${fmtH(r.ot)})</td><td>${yen(r.otPay)}</td></tr>`:''}
        ${r.trans?`<tr><td>交通費</td><td>${yen(r.trans)}</td></tr>`:''}
        <tr class="total"><td>合計</td><td>${yen(r.pay)}</td></tr>
      </table>${r.pay!==r.done?`<p class="muted">うち今日までの確定分 ${yen(r.done)}</p>`:''}</div>`);
  });
  const tgt = state.settings.target||0;
  const pct = tgt ? Math.min(100, r2(grand/tgt*100)) : 0;
  html += `<div class="card"><div class="muted">${m}月分の合計(全勤務先)</div><div class="big">${yen(grand)}</div>
    ${tgt?`<div class="bar-wrap"><i class="${grand>=tgt?'ok':''}" style="width:${pct}%"></i></div><div class="muted">目標 ${yen(tgt)} まで ${grand>=tgt?'達成！':'あと '+yen(tgt-grand)}</div>`:''}
    ${grand!==grandDone?`<div class="muted">今日までの確定分 ${yen(grandDone)} ／ 予定 ${yen(grand-grandDone)}</div>`:''}</div>`;
  html += cards.join('');
  // 年収の壁
  const wall = Number(state.settings.wall||0);
  let yearTotal = 0; const yf=`${y}-01-01`, yt=`${y}-12-31`;
  state.shifts.filter(s=>s.date>=yf&&s.date<=yt).forEach(s=>{ yearTotal += calcShift(s,wp(s.wid)).pay; });
  const wpct = wall ? Math.min(100, r2(yearTotal/wall*100)) : 0;
  html += `<div class="card"><h2>${y}年の年収見込み</h2><div class="big">${yen(yearTotal)}</div>
    ${wall?`<div class="bar-wrap"><i class="${yearTotal>=wall?'over':wpct>=85?'warn':''}" style="width:${wpct}%"></i></div><div class="muted">${yen(wall)}の壁まで ${yearTotal>=wall?'<b style="color:var(--danger)">超えています</b>':'あと '+yen(wall-yearTotal)+(wpct>=85?' ／ そろそろ注意':'')}</div>`:''}
    <p class="muted">交通費も合計に含めています(非課税の交通費は壁の計算から除ける場合があります)。</p></div>`;
  box.innerHTML = html;
}
const r2 = n => Math.round(n*10)/10;

/* ---------- workplaces ---------- */
function renderWork(){
  const box = $('#workList'); box.innerHTML='';
  if (!state.workplaces.length){ box.innerHTML = `<div class="empty">勤務先を追加すると、シフト入力と給料計算ができます</div>`; return; }
  state.workplaces.forEach((w,i)=>{
    const el = document.createElement('div'); el.className='card work-item'+(w.hidden?' hidden-w':'');
    el.innerHTML = `<span class="dot" style="width:14px;height:14px;border-radius:50%;background:${w.color};flex:none"></span><div class="t"><b>${esc(w.name)}</b><small>時給${yen(wageAt(w,ymd(new Date())))} ／ ${w.closingDay==='end'?'月末':w.closingDay+'日'}締め ／ ${(w.patterns||[]).length}パターン${w.hidden?' ／ 非表示':''}</small></div>
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
function fillDaySelect(sel, withEnd){
  sel.innerHTML = (withEnd?'<option value="end">月末</option>':'') + Array.from({length:28},(_,i)=>`<option value="${i+1}">${i+1}日</option>`).join('');
}
let editingW = null;
function openWorkDlg(w){
  editingW = w || null;
  $('#workTitle').textContent = w ? '勤務先を編集' : '勤務先を追加';
  $('#wId').value = w?w.id:'';
  $('#wName').value = w?w.name:'';
  $('#wWage').value = w?w.wage:'';
  $('#wTrans').value = w?(w.transport||0):0;
  fillDaySelect($('#wClose'), true); fillDaySelect($('#wPay'), true);
  $('#wClose').value = w?(w.closingDay||'end'):'end';
  $('#wPay').value = w?(w.payDay||'end'):'25';
  $('#wPayMonth').value = w?(w.payMonthOffset ?? 1):1;
  $('#wNight').value = w?(w.nightRate ?? 25):25; $('#wNightS').value = w?(w.nightStart ?? 22):22; $('#wNightE').value = w?(w.nightEnd ?? 5):5;
  $('#wOt').value = w?(w.otRate ?? 25):25; $('#wOtAfter').value = w?(w.otAfterHours ?? 8):8;
  $('#wBreak').value = w?(w.breakMin ?? 0):0; $('#wRound').value = w?(w.round||1):1;
  const used = new Set(state.workplaces.filter(x=>!w||x.id!==w.id).map(x=>x.color));
  const col = w?w.color:(COLORS.find(c=>!used.has(c))||COLORS[0]);
  const cb = $('#wColors'); cb.innerHTML=''; COLORS.forEach(c=>{ const s=document.createElement('span'); s.style.background=c; if(c===col) s.classList.add('on'); s.dataset.c=c; s.onclick=()=>{ cb.querySelectorAll('span').forEach(x=>x.classList.remove('on')); s.classList.add('on'); }; cb.appendChild(s); });
  renderWageHist(w?(w.wageHistory||[]):[]);
  renderPatterns(w?(w.patterns||[]):(w?[]:[{name:'通常',start:'09:00',end:'17:00',breakMin:60}]));
  $('#wDelete').style.display = w?'':'none';
  $('#workDlg').classList.remove('hidden');
}
function renderWageHist(list){
  const box=$('#wWageHist'); box.innerHTML='';
  list.forEach(h=>addWageRow(h.from,h.wage));
}
function addWageRow(from='',wage=''){
  const r=document.createElement('div'); r.className='histrow';
  r.innerHTML=`<label>この日から<input type="date" class="hFrom" value="${from}"></label><label>時給<input type="number" class="hWage" value="${wage}" inputmode="numeric"></label><button type="button">✕</button>`;
  r.querySelector('button').onclick=()=>r.remove();
  $('#wWageHist').appendChild(r);
}
function renderPatterns(list){ const box=$('#wPatterns'); box.innerHTML=''; list.forEach(p=>addPatRow(p)); }
function addPatRow(p={name:'',start:'09:00',end:'17:00',breakMin:''}){
  const r=document.createElement('div'); r.className='patrow';
  r.innerHTML=`<label>名前<input type="text" class="pName" value="${esc(p.name)}" placeholder="早番"></label><label>開始<input type="time" class="pS" value="${p.start}"></label><label>終了<input type="time" class="pE" value="${p.end}"></label><button type="button">✕</button>
    <label style="grid-column:1/3">休憩(分)<input type="number" class="pB" value="${p.breakMin ?? ''}" placeholder="標準" inputmode="numeric"></label>`;
  r.querySelector('button').onclick=()=>r.remove();
  $('#wPatterns').appendChild(r);
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
  w.otRate=Number($('#wOt').value); w.otAfterHours=Number($('#wOtAfter').value); w.breakMin=Number($('#wBreak').value)||0; w.round=Number($('#wRound').value)||1;
  w.wageHistory=[...$('#wWageHist .histrow')].map(r=>({from:r.querySelector('.hFrom').value, wage:Number(r.querySelector('.hWage').value)})).filter(h=>h.from&&h.wage>0);
  w.patterns=[...$('#wPatterns .patrow')].map(r=>({name:r.querySelector('.pName').value.trim()||'シフト', start:r.querySelector('.pS').value, end:r.querySelector('.pE').value, breakMin:r.querySelector('.pB').value===''?undefined:Number(r.querySelector('.pB').value)})).filter(p=>p.start&&p.end);
  if(!editingW) state.workplaces.push(w);
  save(); $('#workDlg').classList.add('hidden'); render(); toast('保存しました');
};
$('#wDelete').onclick=()=>{ if(!editingW) return; const n=state.shifts.filter(s=>s.wid===editingW.id).length; if(!confirm(`「${editingW.name}」を削除しますか？\n登録済みのシフト${n}件も削除されます。`)) return; state.shifts=state.shifts.filter(s=>s.wid!==editingW.id); state.workplaces=state.workplaces.filter(w=>w.id!==editingW.id); save(); $('#workDlg').classList.add('hidden'); render(); };

/* ---------- settings ---------- */
function renderSettings(){
  $('#setTarget').value = state.settings.target||'';
  $('#setWall').value = String(state.settings.wall ?? 1030000);
  $('#setNotify').checked = !!state.settings.notify;
}
$('#setTarget').onchange = e=>{ state.settings.target=Number(e.target.value)||0; save(); render(); };
$('#setWall').onchange = e=>{ state.settings.wall=Number(e.target.value); save(); render(); };
$('#setNotify').onchange = async e=>{ state.settings.notify=e.target.checked; save(); if(e.target.checked && 'Notification' in window && Notification.permission==='default') await Notification.requestPermission(); checkTomorrow(true); };
$('#exportJson').onclick=()=>download(`shift-backup-${ymd(new Date())}.json`, JSON.stringify(state,null,1), 'application/json');
$('#importJson').onclick=()=>$('#importFile').click();
$('#importFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader(); fr.onload=()=>{ try{ const s=JSON.parse(fr.result); if(!s.workplaces||!s.shifts) throw 0; if(!confirm('今のデータを上書きして読み込みますか？')) return; state=s; save(); render(); toast('読み込みました'); }catch{ alert('ファイルの形式が違います'); } }; fr.readAsText(f); e.target.value=''; };
$('#exportIcs').onclick=()=>{
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//shiftnote//JP','X-WR-CALNAME:シフト手帳'];
  state.shifts.forEach(s=>{ const w=wp(s.wid); if(!w) return; const d=parseD(s.date); const sm=toMin(s.start); let em=toMin(s.end); const e=new Date(d); if(em<=sm) e.setDate(e.getDate()+1);
    const f=(dt,t)=>`${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${t.replace(':','')}00`;
    lines.push('BEGIN:VEVENT',`UID:${s.id}@shiftnote`,`DTSTART:${f(d,s.start)}`,`DTEND:${f(e,s.end)}`,`SUMMARY:${w.name}${s.memo?' '+s.memo:''}`,`DESCRIPTION:${yen(calcShift(s,w).pay)}`,'END:VEVENT'); });
  lines.push('END:VCALENDAR');
  download('shift.ics', lines.join('\r\n'), 'text/calendar');
};
$('#resetAll').onclick=()=>{ if(!confirm('すべてのデータを削除しますか？')) return; if(!confirm('本当に削除しますか？元に戻せません。')) return; localStorage.removeItem(KEY); state=load(); render(); };
function download(name, text, type){
  const blob = new Blob([text], {type});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
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

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(()=>{});
render();
if (!state.workplaces.length) { switchView('work'); setTimeout(()=>toast('まず勤務先を登録しましょう'), 300); }
checkTomorrow(false);
})();
