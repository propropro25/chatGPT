const daysEl = document.getElementById('days');
const listEl = document.getElementById('list');
const metaEl = document.getElementById('meta');
const qEl = document.getElementById('q');
const toolbarEl = document.getElementById('toolbar');
const introEl = document.getElementById('intro');
const dropEl = document.getElementById('drop');

const btnCloud = document.getElementById('mode-cloud');
const btnLocal = document.getElementById('mode-local');
const fileEl = document.getElementById('file');

let MODE = 'cloud';         // 'cloud' | 'local'
let INDEX = null;           // { days: [{day,count,keywords}], ... }
let CURRENT = null;         // { day, items: [...] }
let LOCAL_QUESTIONS = null; // when processing local JSON

function setMode(m) {
  MODE = m;
  btnCloud.classList.toggle('active', m === 'cloud');
  btnLocal.classList.toggle('active', m === 'local');
  dropEl.classList.toggle('hidden', m !== 'local');
  if (m === 'cloud') loadIndex();
}

btnCloud.onclick = () => setMode('cloud');
btnLocal.onclick = () => setMode('local');

qEl.addEventListener('input', () => renderList());

document.getElementById('export-md').onclick = () => {
  if (!CURRENT) return;
  const md = [
    `# Questions – ${CURRENT.day}`,
    '',
    ...CURRENT.items.map((it, i) => `- ${it.text}`)
  ].join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `questions-${CURRENT.day}.md` });
  a.click(); URL.revokeObjectURL(a.href);
});

document.getElementById('print').onclick = () => window.print();

// Drag & drop (local mode)
;['dragenter','dragover'].forEach(evt => dropEl.addEventListener(evt, e => {
  e.preventDefault(); e.stopPropagation(); dropEl.style.borderColor = '#6aa0ff';
}));
;['dragleave','drop'].forEach(evt => dropEl.addEventListener(evt, e => {
  e.preventDefault(); e.stopPropagation(); dropEl.style.borderColor = '#2c3c5a';
}));
dropEl.addEventListener('drop', async (e) => {
  const f = (e.dataTransfer.files || [])[0];
  if (f) processLocalFile(f);
});
btnLocal.addEventListener('dblclick', () => fileEl.click());
fileEl.onchange = () => fileEl.files[0] && processLocalFile(fileEl.files[0]);

async function processLocalFile(file) {
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); }
  catch { return alert('Invalid JSON'); }

  LOCAL_QUESTIONS = extractQuestions(json);
  INDEX = buildIndex(LOCAL_QUESTIONS);
  renderDays();
  introEl.classList.add('hidden');
}

async function loadIndex() {
  try {
    const res = await fetch('./data/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('no index.json yet');
    INDEX = await res.json();
    renderDays();
    introEl.classList.add('hidden');
  } catch (e) {
    introEl.innerHTML = `<p><b>No cloud data yet.</b> Publish a Release with <code>conversations.json</code>, or switch to <b>Local</b> and drop the file here.</p>`;
    introEl.classList.remove('hidden');
  }
}

function renderDays() {
  daysEl.innerHTML = '';
  const days = INDEX.days || [];
  for (const d of days) {
    const div = document.createElement('div');
    div.className = 'day';
    div.innerHTML = `<div><b>${d.day}</b> · ${d.count}</div><div class="kws">${(d.keywords||[]).join(' • ')}</div>`;
    div.onclick = () => openDay(d.day);
    daysEl.appendChild(div);
  }
}

async function openDay(day) {
  toolbarEl.classList.remove('hidden');
  if (MODE === 'cloud') {
    const res = await fetch(`./data/day-${day}.json`, { cache: 'no-store' });
    CURRENT = await res.json();
  } else {
    CURRENT = LOCAL_QUESTIONS[day];
  }
  metaEl.textContent = `${CURRENT.count || CURRENT.items.length} questions`;
  renderList();
}

function renderList() {
  const term = (qEl.value || '').toLowerCase();
  listEl.innerHTML = '';
  if (!CURRENT) return;
  const items = CURRENT.items || [];
  for (const it of items) {
    if (term && !it.text.toLowerCase().includes(term)) continue;
    const li = document.createElement('li');
    li.textContent = it.text;
    listEl.appendChild(li);
  }
}

/* -------- Local extraction (mirrors process.js logic) -------- */

function extractQuestions(blob) {
  const conversations = Array.isArray(blob) ? blob :
                        Array.isArray(blob.conversations) ? blob.conversations :
                        Array.isArray(blob.items) ? blob.items :
                        Array.isArray(blob.data) ? blob.data : [];
  const byDate = {};
  for (const conv of conversations) {
    const mapping = conv.mapping;
    let msgs = [];
    if (mapping) {
      const vals = Object.values(mapping).map(n => n && n.message ? n.message : n).filter(Boolean);
      msgs = vals.map(n => ({
        role: n.author?.role || n.author,
        text: safeTextLocal(n),
        t: asUnixLocal(n.create_time || n.metadata?.create_time || n.createTime)
      }));
    } else {
      const arr = conv.messages || conv.items || [];
      msgs = arr.map(n => ({
        role: n.author?.role || n.role,
        text: safeTextLocal(n),
        t: asUnixLocal(n.create_time || n.createTime || n.metadata?.create_time)
      }));
    }
    msgs = msgs.filter(m => m.role === 'user' && m.text).sort((a,b)=>(a.t||0)-(b.t||0));
    for (const m of msgs) {
      const day = m.t ? formatDateLocal(m.t) : 'unknown';
      (byDate[day] ||= { day, items: [], count:0, keywords:[] }).items.push({ time:m.t, text:m.text, title: conv.title||'' });
      byDate[day].count++;
    }
  }
  // Simple keywords
  for (const d of Object.values(byDate)) d.keywords = keywordsLocal(d.items);
  return byDate;
}

function safeTextLocal(n) {
  if (!n) return '';
  const c = n.content || n.message?.content || {};
  if (Array.isArray(c.parts)) return c.parts.join('\n').trim();
  if (typeof c.text === 'string') return c.text.trim();
  if (typeof n.text === 'string') return n.text.trim();
  if (typeof c === 'string') return c.trim();
  return '';
}
function asUnixLocal(x){ return x ? (x>1e12?Math.floor(x/1000):Math.floor(x)) : 0; }
function formatDateLocal(u){ const d=new Date(u*1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function keywordsLocal(items){
  const stop=new Set('a an the and or but so if then of for from to into onto in on with without is are was were be been being this that these those i you he she we they it my your his her our their me him her them do does did not no yes just really very can could would should may might will wont don’t doesnt isnt isnt\'t cant can’t shouldn’t wouldn’t couldn’t'.split(/\s+/));
  const freq={};
  for(const it of items){
    (it.text.toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^a-z0-9\s'-]+/g,' ').split(/\s+/)).forEach(w=>{
      if(!w||w.length<3||stop.has(w)) return; freq[w]=(freq[w]||0)+1;
    });
  }
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k])=>k);
}

function buildIndex(byDate) {
  const days = Object.values(byDate).sort((a,b) => a.day.localeCompare(b.day));
  return {
    totalDays: days.length,
    totalQuestions: days.reduce((s,d)=>s+(d.count||d.items.length),0),
    days: days.map(d => ({ day: d.day, count: d.count||d.items.length, keywords: d.keywords||[] }))
  };
}
