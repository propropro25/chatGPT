// scripts/process.js
// Usage in Actions: node scripts/process.js conversations.json
import fs from 'fs';
import path from 'path';

const inFile = process.argv[2] || 'conversations.json';
const outDir = path.join('site', 'data');
fs.mkdirSync(outDir, { recursive: true });

function safeText(m) {
  // ChatGPT exports vary. Try several shapes.
  if (!m) return '';
  if (typeof m === 'string') return m;
  if (m.content) {
    // OpenAI classic exports: content.parts or content.text
    if (Array.isArray(m.content.parts)) return m.content.parts.join('\n').trim();
    if (typeof m.content.text === 'string') return m.content.text.trim();
    if (typeof m.content === 'string') return m.content.trim();
  }
  if (m.message && m.message.content) {
    const c = m.message.content;
    if (Array.isArray(c.parts)) return c.parts.join('\n').trim();
    if (typeof c.text === 'string') return c.text.trim();
  }
  if (m.text) return m.text.trim();
  return '';
}

function asUnix(msOrSec) {
  if (!msOrSec) return null;
  // Some exports have seconds, others ms
  return msOrSec > 1e12 ? Math.floor(msOrSec/1000) : Math.floor(msOrSec);
}

function formatDate(unixtime) {
  const d = new Date(unixtime * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractUserMsgsFromMapping(conv) {
  const mapping = conv.mapping || {};
  const items = Object.values(mapping)
    .map(n => n && n.message ? n.message : n)
    .filter(Boolean);

  const msgs = items.map(n => {
    const role = n.author?.role || n.author || n.metadata?.role;
    const text = safeText(n);
    const t = asUnix(n.create_time || n.metadata?.create_time || n.createTime);
    return { role, text, t };
  }).filter(m => m.role === 'user' && m.text);

  // Sort by time; if missing, keep stable
  msgs.sort((a,b) => (a.t||0) - (b.t||0));
  return msgs;
}

function extractUserMsgsFromMessagesArray(conv) {
  const arr = conv.messages || conv.items || [];
  const msgs = arr.map(n => {
    const role = n.author?.role || n.role;
    const text = safeText(n);
    const t = asUnix(n.create_time || n.createTime || n.metadata?.create_time);
    return { role, text, t };
  }).filter(m => m.role === 'user' && m.text);
  msgs.sort((a,b) => (a.t||0) - (b.t||0));
  return msgs;
}

function extractConversations(json) {
  // try common roots
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.conversations)) return json.conversations;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

function tokenize(s) {
  return s.toLowerCase()
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/[^a-z0-9\s'-]+/g,' ')
    .split(/\s+/)
    .filter(Boolean);
}

const STOP = new Set(('a an the and or but so if then else when whenever of for from to into onto in on with without ' +
  'is are was were be been being this that these those i you he she we they it my your his her our their me him her them '+
  'do does did doing done not no yes true false just really very can could would should may might will wont don’t doesnt isn’t’ isnt cant can’t shouldn’t wouldn’t couldn’t').split(/\s+/));

function keywordsForDay(items, topN=12) {
  const freq = Object.create(null);
  for (const q of items) {
    for (const w of tokenize(q.text)) {
      if (STOP.has(w)) continue;
      if (w.length < 3) continue;
      freq[w] = (freq[w]||0)+1;
    }
  }
  const arr = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0, topN).map(([k])=>k);
  return arr;
}

function tryParse(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Some exports are one giant JSON, others newline-delimited. Try JSON first.
  try {
    return JSON.parse(raw);
  } catch {
    // Try NDJSON
    const lines = raw.split(/\n+/).filter(Boolean);
    const items = lines.map(l => JSON.parse(l)).flat();
    return { conversations: items };
  }
}

console.log(`Reading ${inFile} ...`);
const blob = tryParse(inFile);
const conversations = extractConversations(blob);

let questions = [];
for (const conv of conversations) {
  const title = conv.title || conv.name || '';
  let msgs = [];
  if (conv.mapping) msgs = extractUserMsgsFromMapping(conv);
  else msgs = extractUserMsgsFromMessagesArray(conv);

  for (const m of msgs) {
    if (!m.text) continue;
    const t = m.t || 0;
    questions.push({
      time: t,
      date: t ? formatDate(t) : null,
      text: m.text,
      conversationTitle: title
    });
  }
}

// Group by date
const byDate = {};
for (const q of questions) {
  const d = q.date || 'unknown';
  (byDate[d] ||= []).push(q);
}

// Write index + day files
const days = Object.keys(byDate).sort();
const index = [];
for (const d of days) {
  // Remove time for compact day file; keep order
  const items = byDate[d].map((q,i)=>({
    i,
    time: q.time,
    text: q.text,
    title: q.conversationTitle || ''
  }));
  const kw = keywordsForDay(items);
  const dayPath = path.join(outDir, `day-${d}.json`);
  fs.writeFileSync(dayPath, JSON.stringify({ day: d, count: items.length, keywords: kw, items }, null, 0));
  index.push({ day: d, count: items.length, keywords: kw });
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ totalDays: days.length, totalQuestions: questions.length, days: index }, null, 2));

console.log(`Wrote ${days.length} day files to ${outDir}`);

