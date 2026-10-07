/* シフト手帳 - features.js: グラフ・達成演出・プッシュ通知・壁の診断・グループ共有 */
(() => {
'use strict';
const SN = window.SN; if (!SN) return;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const { yen, ymd, pad, parseD, esc, fmtH } = SN;
const st = () => SN.state;

/* ================= 1. 収入グラフ ================= */
function monthTotal(y, m){ // m: 0-11 暦月
  const from=`${y}-${pad(m+1)}-01`, to=`${y}-${pad(m+1)}-${pad(new Date(y,m+1,0).getDate())}`;
  let t=0; st().shifts.filter(s=>s.date>=from&&s.date<=to&&SN.counted(s)).forEach(s=>{ const w=SN.wp(s.wid); if(w&&!w.hidden) t+=SN.calcShift(s,w).pay; }); return t;
}
function renderChart(){
  const box=$('#chartBox'); if(!box) return;
  if(!st().workplaces.length){ box.innerHTML=''; return; }
  const cur=SN.cur(); const months=[]; for(let i=5;i>=0;i--){ const d=new Date(cur.getFullYear(),cur.getMonth()-i,1); months.push({y:d.getFullYear(),m:d.getMonth(),v:monthTotal(d.getFullYear(),d.getMonth())}); }
  const tgt=st().settings.target||0; const max=Math.max(tgt, ...months.map(x=>x.v), 1);
  const avg=Math.round(months.reduce((a,b)=>a+b.v,0)/6);
  box.innerHTML=`<div class="card chart"><div class="chart-head"><b>月別の収入</b><span class="muted">6か月平均 ${yen(avg)}</span></div>
    <div class="bars">${months.map((x,i)=>`<div class="bar-col"><div class="bar-v">${x.v?yen(x.v).replace('¥',''):''}</div><div class="bar-track">${tgt?`<i class="tline" style="bottom:${tgt/max*100}%"></i>`:''}<i class="bar ${i===5?'now':''} ${tgt&&x.v>=tgt?'hit':''}" style="--h:${x.v/max*100}%"></i></div><div class="bar-l">${x.m+1}月</div></div>`).join('')}</div>
    ${tgt?`<div class="muted">点線 = 目標 ${yen(tgt)}</div>`:''}</div>`;
  requestAnimationFrame(()=>box.querySelectorAll('.bar').forEach(b=>b.classList.add('grow')));
}

/* ================= 2. 達成演出 ================= */
function celebrate(){
  const cur=SN.cur(); const tgt=st().settings.target||0; if(!tgt) return;
  const key=`${cur.getFullYear()}-${pad(cur.getMonth()+1)}`; const now=new Date();
  if (key!==`${now.getFullYear()}-${pad(now.getMonth()+1)}`) return;
  if (monthTotal(cur.getFullYear(),cur.getMonth()) < tgt) return;
  if (localStorage.getItem('shiftnote.hit')===key) return;
  localStorage.setItem('shiftnote.hit', key);
  const c=document.createElement('div'); c.className='confetti';
  for(let i=0;i<60;i++){ const p=document.createElement('i'); p.style.left=Math.random()*100+'%'; p.style.background=['#2f6fed','#e0433a','#1fa864','#e8a300','#ff5c8a','#8e44ad'][i%6]; p.style.animationDelay=(Math.random()*0.8)+'s'; p.style.animationDuration=(1.6+Math.random())+'s'; c.appendChild(p); }
  const msg=document.createElement('div'); msg.className='hitmsg'; msg.innerHTML=`🎉<br>今月の目標 ${yen(tgt)} 達成！`; c.appendChild(msg);
  document.body.appendChild(c); setTimeout(()=>c.remove(), 3200); c.onclick=()=>c.remove();
}

/* ================= 3. プッシュ通知(Capacitor) ================= */
const LN = () => window.Capacitor?.Plugins?.LocalNotifications;
let notifTimer=null;
async function scheduleNotifications(){
  const ln=LN(); if(!ln) return;
  const s=st().settings; const hasEv=st().events.some(e=>e.remind); if(!s.notify && !s.notifyPay && !hasEv) return;
  try{
    const perm=await ln.checkPermissions(); if(perm.display!=='granted'){ const r=await ln.requestPermissions(); if(r.display!=='granted') return; }
    const pend=await ln.getPending(); if(pend.notifications?.length) await ln.cancel({notifications:pend.notifications.map(n=>({id:n.id}))});
    const list=[]; const now=new Date(); let id=1;
    const hour=Number(s.notifyHour ?? 20);
    for(let i=0;i<45;i++){
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i+1); const ds=ymd(d);
      const sh=SN.shiftsOn(ds).filter(x=>SN.wp(x.wid)&&!SN.wp(x.wid).hidden);
      if(s.notify && sh.length){
        const at=new Date(d); at.setDate(at.getDate()-1); at.setHours(hour,0,0,0);
        if(at>now) list.push({id:id++, title:'明日のシフト', body: sh.map(x=>`${SN.wp(x.wid).name} ${x.start}〜${x.end}`).join(' / '), schedule:{at}});
      }
    }
    if(s.notifyPay){
      st().workplaces.filter(w=>!w.hidden).forEach(w=>{ for(let k=0;k<=2;k++){ const d=new Date(now.getFullYear(),now.getMonth()+k,1); const pd=SN.payDate(w,d.getFullYear(),d.getMonth()+1); pd.setHours(9,0,0,0); if(pd<=now) continue; const [f,t]=SN.period(w,d.getFullYear(),d.getMonth()+1); const r=SN.sumRange(w,f,t); if(r.pay>0) list.push({id:id++, title:'今日は給料日', body:`${w.name} ${yen(r.pay)}の予定`, schedule:{at:pd}}); } });
    }
    // 予定のリマインド
    const limit=new Date(now); limit.setDate(limit.getDate()+60);
    st().events.filter(e=>e.remind && e.date>=ymd(now) && e.date<=ymd(limit)).forEach(e=>{
      const d=SN.parseD(e.date); let at=null;
      if(e.remind==='day9'){ at=new Date(d); at.setHours(9,0,0,0); }
      else if(e.remind==='prev20'){ at=new Date(d); at.setDate(at.getDate()-1); at.setHours(20,0,0,0); }
      else if((e.remind==='m30'||e.remind==='m60') && !e.allDay && e.start){ const [hh,mm]=e.start.split(':').map(Number); at=new Date(d); at.setHours(hh,mm,0,0); at.setMinutes(at.getMinutes()-(e.remind==='m30'?30:60)); }
      if(at && at>now) list.push({id:id++, title:'予定', body:(e.allDay?'終日':e.start+'〜'+e.end)+' '+e.title+(e.memo?' / '+e.memo:''), schedule:{at}});
    });
    if(list.length) await ln.schedule({notifications:list});
  }catch(e){ console.warn('notif', e); }
}
SN.onSave.push(()=>{ clearTimeout(notifTimer); notifTimer=setTimeout(scheduleNotifications, 1500); });
const payChk=$('#setNotifyPay'), hourSel=$('#setNotifyHour');
if(payChk){ payChk.onchange=e=>{ st().settings.notifyPay=e.target.checked; SN.save(); }; }
if(hourSel){ hourSel.innerHTML=[17,18,19,20,21,22].map(h=>`<option value="${h}">${h}:00</option>`).join(''); hourSel.onchange=e=>{ st().settings.notifyHour=Number(e.target.value); SN.save(); }; }
SN.onRender.push(()=>{ if(payChk) payChk.checked=!!st().settings.notifyPay; if(hourSel) hourSel.value=String(st().settings.notifyHour??20); const n=$('#notifNote'); if(n) n.textContent = LN() ? '端末のプッシュ通知で届きます。' : 'ブラウザ版はアプリを開いたときにお知らせします。Android版では端末の通知として届きます。'; });

/* ================= 4. 年収の壁 診断 ================= */
const TAX_Q = [
  {k:'age', q:'あなたは？', opts:[['student','19〜22歳の学生'],['youngStudent','18歳以下、または23歳以上の学生'],['adult','学生ではない(18歳以下も含む)']]},
  {k:'dep', q:'誰かの扶養に入っていますか？', opts:[['parent','親の扶養'],['spouse','配偶者の扶養'],['none','入っていない(自分で保険料を払っている)']]},
  {k:'big', q:'勤務先(どれか1つでも)は従業員51人以上で、週20時間以上働く見込みですか？', opts:[['yes','はい'],['no','いいえ / わからない']]},
  {k:'want', q:'優先したいのは？', opts:[['safe','扶養から絶対に外れたくない'],['more','多少税金を払っても多く稼ぎたい']]},
];
function taxResult(a){
  const items=[]; let rec=0;
  items.push({name:'所得税(自分)', amt:1600000, note:'2025年の改正で103万→160万に。これ以下なら所得税はかかりません。'});
  items.push({name:'住民税(自分)', amt:1100000, note:'おおむね100〜110万を超えると翌年に少額の住民税がかかります(自治体で差あり)。'});
  if (a.dep!=='none'){
    const isStudent = a.age==='student' || a.age==='youngStudent';
    if (a.big==='yes' && !isStudent) items.push({name:'社会保険(自分で加入)', amt:1060000, note:'従業員51人以上・週20時間以上・月8.8万円以上で、自分で社会保険に入ることになり手取りが減ります。昼間の学生は対象外。'});
    items.push({name:`社会保険の扶養(${a.dep==='parent'?'親':'配偶者'})`, amt:1300000, note:'年収130万円(月108,334円)以上の見込みになると扶養から外れ、自分で保険料(年20万前後)を払うことになります。交通費も含めて判定されることが多いです。'});
    if (a.dep==='parent') items.push( a.age==='student' ? {name:'親の税金(特定親族特別控除)', amt:1500000, note:'19〜22歳の学生は150万まで親の控除が満額。150〜188万は段階的に減ります。'} : {name:'親の税金(扶養控除)', amt:1230000, note:'123万を超えると親の扶養控除がなくなり、親の税金が増えます(目安5〜10万円/年)。'} );
    if (a.dep==='spouse') items.push({name:'配偶者の税金(配偶者特別控除)', amt:1600000, note:'160万まで配偶者の控除が満額。201万まで段階的に減ります。'});
  }
  const sorted=[...items].sort((x,y)=>x.amt-y.amt);
  if (a.dep==='none') rec = a.want==='safe' ? 1100000 : 1600000;
  else if (a.want==='safe') rec = sorted.find(i=>i.name.startsWith('社会保険'))?.amt || 1300000;
  else rec = 1300000;
  if (a.dep!=='none' && a.want==='safe'){ const parentWall = sorted.find(i=>i.name.startsWith('親の税金')||i.name.startsWith('配偶者の税金')); if(parentWall && parentWall.amt<rec) rec=parentWall.amt; }
  return {items:sorted, rec};
}
function openTax(){
  const dlg=$('#taxDlg'); const body=$('#taxBody'); const ans={}; let i=0;
  const step=()=>{
    if(i<TAX_Q.length){ const q=TAX_Q[i]; body.innerHTML=`<div class="muted">質問 ${i+1}/${TAX_Q.length}</div><h3 class="tq">${q.q}</h3>${q.opts.map(([v,l])=>`<button class="opt" data-v="${v}">${l}</button>`).join('')}`;
      body.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{ ans[q.k]=b.dataset.v; i++; step(); }); return; }
    const r=taxResult(ans); const y=new Date().getFullYear();
    let yearTotal=0; st().shifts.filter(s=>s.date.startsWith(y+'-')&&SN.counted(s)).forEach(s=>{ yearTotal+=SN.calcShift(s,SN.wp(s.wid)).pay; });
    const wages=st().workplaces.filter(w=>!w.hidden).map(w=>SN.wageAt(w,ymd(new Date()))); const avgW=wages.length?wages.reduce((a,b)=>a+b,0)/wages.length:1000;
    const left=r.rec-yearTotal; const monthsLeft=12-new Date().getMonth();
    body.innerHTML=`<h3 class="tq">あなたの壁は <span class="accent">${yen(r.rec)}</span></h3>
      <div class="preview"><b>${left>0?'あと '+yen(left):'超えています'}</b>${left>0?` ／ 約${Math.floor(left/avgW)}時間 ／ 残り${monthsLeft}か月で月${yen(left/monthsLeft)}まで`:''}<br><span class="muted">今年の見込み ${yen(yearTotal)}(交通費込み)</span></div>
      <button class="primary wide" id="taxApply">この壁を設定する</button>
      <h4>あなたに関係する壁</h4>${r.items.map(it=>`<div class="wall-item ${it.amt===r.rec?'rec':''}"><b>${yen(it.amt)}</b> ${it.name}<small>${it.note}</small></div>`).join('')}
      <p class="muted">2025年税制改正後の目安です。制度は変わるので、最終判断は国税庁・勤務先・加入している健康保険にご確認ください。社会保険の106万円の条件は2026年以降に段階的に撤廃される予定です。</p>
      <button class="small" id="taxAgain">もう一度診断する</button>`;
    $('#taxApply').onclick=()=>{ st().settings.wall=r.rec; SN.save(); SN.render(); dlg.classList.add('hidden'); SN.toast(`年収の壁を ${yen(r.rec)} に設定しました`); };
    $('#taxAgain').onclick=()=>{ i=0; step(); };
  };
  step(); dlg.classList.remove('hidden');
}
$('#taxOpen')?.addEventListener('click', openTax);
$('#taxClose')?.addEventListener('click', ()=>$('#taxDlg').classList.add('hidden'));
$('#taxDlg')?.addEventListener('click', e=>{ if(e.target.id==='taxDlg') e.target.classList.add('hidden'); });

/* ================= 5. グループ共有(Firebase) ================= */
const FB_KEY='shiftnote.firebase', GR_KEY='shiftnote.group';
let fb=null, unsub=null, pushTimer=null;
const myName = () => st().settings.myName || '';
function fbConfig(){ try{ return JSON.parse(localStorage.getItem(FB_KEY)||'null'); }catch{ return null; } }
function groupInfo(){ try{ return JSON.parse(localStorage.getItem(GR_KEY)||'null'); }catch{ return null; } }
async function fbInit(){
  if (fb) return fb; const cfg=fbConfig(); if(!cfg) return null;
  const v='10.12.4';
  const [app, fs, au] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`)]);
  const a=app.initializeApp(cfg); const db=fs.getFirestore(a); const auth=au.getAuth(a);
  const cred=await au.signInAnonymously(auth);
  fb={db, fs, uid:cred.user.uid}; return fb;
}
function myShiftsPayload(){
  const from=ymd(new Date()); const to=new Date(); to.setDate(to.getDate()+60);
  return st().shifts.filter(s=>s.date>=from&&s.date<=ymd(to)&&SN.wp(s.wid)&&!SN.wp(s.wid).hidden).sort((a,b)=>a.date<b.date?-1:1).map(s=>({date:s.date,start:s.start,end:s.end,w:SN.wp(s.wid).name,t:!!s.tentative}));
}
async function pushMine(){
  const g=groupInfo(); if(!g) return; const f=await fbInit(); if(!f) return;
  await f.fs.setDoc(f.fs.doc(f.db,'groups',g.code,'members',f.uid), {name:myName()||'名無し', shifts:myShiftsPayload(), updated:Date.now()});
}
SN.onSave.push(()=>{ if(groupInfo()){ clearTimeout(pushTimer); pushTimer=setTimeout(()=>pushMine().catch(e=>console.warn(e)), 2000); } });
async function createGroup(name){
  const f=await fbInit(); if(!f) throw new Error('Firebaseの設定がありません');
  const code=Math.random().toString(36).slice(2,8).toUpperCase();
  await f.fs.setDoc(f.fs.doc(f.db,'groups',code), {name, created:Date.now(), owner:f.uid});
  localStorage.setItem(GR_KEY, JSON.stringify({code,name})); await pushMine(); listen(); renderGroup();
}
async function joinGroup(code){
  const f=await fbInit(); if(!f) throw new Error('Firebaseの設定がありません');
  code=code.trim().toUpperCase(); const snap=await f.fs.getDoc(f.fs.doc(f.db,'groups',code));
  if(!snap.exists()) throw new Error('そのコードのグループはありません');
  localStorage.setItem(GR_KEY, JSON.stringify({code,name:snap.data().name})); await pushMine(); listen(); renderGroup();
}
async function leaveGroup(){
  const g=groupInfo(); if(!g) return; try{ const f=await fbInit(); if(f) await f.fs.deleteDoc(f.fs.doc(f.db,'groups',g.code,'members',f.uid)); }catch(e){}
  if(unsub){unsub();unsub=null;} localStorage.removeItem(GR_KEY); members=[]; renderGroup();
}
let members=[];
async function listen(){
  const g=groupInfo(); if(!g) return; const f=await fbInit(); if(!f) return;
  if(unsub) unsub();
  unsub=f.fs.onSnapshot(f.fs.collection(f.db,'groups',g.code,'members'), snap=>{ members=snap.docs.map(d=>({id:d.id,...d.data()})); renderMembers(); }, e=>{ console.warn(e); $('#groupMembers').innerHTML=`<div class="empty">読み込めません: ${esc(e.message)}</div>`; });
}
function renderMembers(){
  const box=$('#groupMembers'); if(!box) return; const f=fb;
  if(!members.length){ box.innerHTML='<div class="empty">まだメンバーがいません。コードを友達に教えましょう。</div>'; return; }
  const today=new Date(); const days=[]; for(let i=0;i<14;i++){ const d=new Date(today); d.setDate(d.getDate()+i); days.push(ymd(d)); }
  const colors=['#2f6fed','#e0433a','#1fa864','#e8a300','#8e44ad','#16a085','#e67e22','#ff5c8a'];
  const colorOf={}; members.forEach((m,i)=>colorOf[m.id]=colors[i%colors.length]);
  let html=`<div class="chips">${members.map(m=>`<span class="mem" style="border-color:${colorOf[m.id]}"><i style="background:${colorOf[m.id]}"></i>${esc(m.name)}${m.id===f?.uid?'(自分)':''}</span>`).join('')}</div>`;
  html+=days.map(ds=>{ const d=parseD(ds); const rows=[]; members.forEach(m=>(m.shifts||[]).filter(s=>s.date===ds).forEach(s=>rows.push(`<div class="grow-row"><i style="background:${colorOf[m.id]}"></i><b>${esc(m.name)}</b> ${s.start}〜${s.end} <span class="muted">${esc(s.w||'')}${s.t?' (希望)':''}</span></div>`)));
    return `<div class="gday ${rows.length?'':'none'}"><div class="gdate ${d.getDay()===0?'sun':d.getDay()===6?'sat':''}">${d.getMonth()+1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})</div><div class="grows">${rows.join('')||'<span class="muted">—</span>'}</div></div>`; }).join('');
  box.innerHTML=html;
}
function renderGroup(){
  const box=$('#groupBox'); if(!box) return;
  const cfg=fbConfig(), g=groupInfo();
  if(!cfg){
    box.innerHTML=`<div class="card"><h2>グループ共有</h2><p>友達やバイト仲間とシフトを見せ合う機能です。無料のFirebase(Google)を使うため、最初に一度だけ設定が必要です。</p>
      <details><summary>設定の手順(5分)</summary><ol class="steps"><li>console.firebase.google.com でプロジェクトを作成</li><li>「ウェブアプリを追加」で表示される firebaseConfig をコピー</li><li>Authentication → ログイン方法 →「匿名」を有効化</li><li>Firestore Database を作成(本番モード)し、ルールをREADMEの内容に置き換え</li><li>下にfirebaseConfigを貼り付けて保存</li></ol></details>
      <label>firebaseConfig を貼り付け<textarea id="fbCfg" rows="5" placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}'></textarea></label>
      <button class="primary wide" id="fbSave">保存</button></div>`;
    $('#fbSave').onclick=()=>{ let t=$('#fbCfg').value.trim(); try{ t=t.replace(/^.*?=\s*/,'').replace(/;\s*$/,''); const j=Function('return ('+t+')')(); if(!j.projectId) throw 0; localStorage.setItem(FB_KEY, JSON.stringify(j)); fb=null; renderGroup(); SN.toast('保存しました'); }catch{ alert('形式が違います。firebaseConfig = { ... } の中身を貼ってください'); } };
    return;
  }
  if(!g){
    box.innerHTML=`<div class="card"><h2>グループ共有</h2>
      <label>あなたの表示名<input type="text" id="gMyName" value="${esc(myName())}" placeholder="例: みさき"></label>
      <div class="grid2"><div><label>新しく作る<input type="text" id="gName" placeholder="グループ名"></label><button class="primary wide" id="gCreate">作成</button></div>
      <div><label>コードで参加<input type="text" id="gCode" placeholder="6文字のコード" style="text-transform:uppercase"></label><button class="primary wide" id="gJoin">参加</button></div></div>
      <p class="muted">共有されるのは今日から60日分のシフト(勤務先名・時間)だけです。給料は共有されません。</p>
      <button class="small" id="fbReset">Firebase設定をやり直す</button></div>`;
    const saveName=()=>{ st().settings.myName=$('#gMyName').value.trim(); SN.save(); };
    $('#gCreate').onclick=async()=>{ saveName(); if(!myName()) return alert('表示名を入れてください'); const n=$('#gName').value.trim()||'シフト仲間'; try{ await createGroup(n); }catch(e){ alert(e.message); } };
    $('#gJoin').onclick=async()=>{ saveName(); if(!myName()) return alert('表示名を入れてください'); try{ await joinGroup($('#gCode').value); }catch(e){ alert(e.message); } };
    $('#fbReset').onclick=()=>{ if(confirm('Firebase設定を削除しますか？')){ localStorage.removeItem(FB_KEY); fb=null; renderGroup(); } };
    return;
  }
  box.innerHTML=`<div class="card"><h2>${esc(g.name)} <span class="muted">コード</span> <b class="code">${g.code}</b></h2>
    <div class="btnrow"><button id="gShareCode">コードを送る</button><button id="gRefresh">今すぐ同期</button><button id="gLeave" class="danger">退出</button></div></div>
    <div id="groupMembers"><div class="empty">読み込み中…</div></div>`;
  $('#gShareCode').onclick=()=>{ const t=`シフト手帳のグループ「${g.name}」に参加してね。コード: ${g.code}`; if(navigator.share) navigator.share({text:t}).catch(()=>{}); else navigator.clipboard?.writeText(t).then(()=>SN.toast('コピーしました')); };
  $('#gRefresh').onclick=()=>pushMine().then(()=>SN.toast('同期しました')).catch(e=>alert(e.message));
  $('#gLeave').onclick=()=>{ if(confirm('グループから退出しますか？')) leaveGroup(); };
  if(!unsub) listen(); else renderMembers();
}

/* ================= 更新チェック ================= */
const APP_VERSION='1.4';
async function checkUpdate(){
  try{
    const r=await fetch('https://mmisaki054-collab.github.io/shift-app/app/version.json?t='+Date.now(), {cache:'no-store'}); if(!r.ok) return;
    const j=await r.json(); if(!j.version || j.version===APP_VERSION) return;
    const cmp=j.version.split('.').map(Number), me=APP_VERSION.split('.').map(Number);
    let newer=false; for(let i=0;i<Math.max(cmp.length,me.length);i++){ const a=cmp[i]||0,b=me[i]||0; if(a>b){newer=true;break;} if(a<b) break; }
    if(!newer) return;
    const bar=$('#updateBar'); if(!bar) return;
    bar.innerHTML='<b>新しい版 v'+esc(j.version)+' があります'+(j.note?'：'+esc(j.note):'')+'</b><a href="'+esc(j.apk||j.page)+'" target="_blank" rel="noopener">更新</a>';
    bar.classList.remove('hidden');
  }catch(e){}
}
checkUpdate();

/* ================= hooks ================= */
SN.onRender.push(()=>{ renderChart(); celebrate(); });
renderChart(); celebrate(); renderGroup(); scheduleNotifications();
if (groupInfo()) pushMine().catch(()=>{});
})();
