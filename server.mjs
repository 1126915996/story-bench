// 故事影像工作台 · 基础框架
// 没有依赖，单文件跑：node server.mjs [port]
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8780);
const DATA = path.join(ROOT, 'data/data.json');
const CONF = path.join(ROOT, 'config.json');
const PUB = path.join(ROOT, 'public');
const MEDIA = path.join(ROOT, 'data/media');
mkdirSync(MEDIA, { recursive: true });

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2));
const db = () => readJson(DATA, { projects: [], assets: [] });
const save = (o) => writeJson(DATA, o);
const conf = () => readJson(CONF, { script: {}, image: {}, video: {} });
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// —— 三家生成服务：都按 OpenAI 兼容格式写好，填 key 就能跑 ——
async function callScript(text, style) {
  const c = conf().script;
  if (!c.baseUrl || !c.key) throw new Error('还没配剧本接口');
  const r = await fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({
      model: c.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是分镜师。把用户给的故事拆成 4-8 个镜头，每行一个镜头，包含画面描述和一句台词，不要编号以外的东西。' },
        { role: 'user', content: `风格：${style || '电影感'}\n故事：${text}` },
      ],
      temperature: 0.8,
    }),
  });
  if (!r.ok) throw new Error(`剧本接口 ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

async function callImage(prompt) {
  const c = conf().image;
  if (!c.baseUrl || !c.key) throw new Error('还没配生图接口');
  const r = await fetch(`${c.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model || 'gpt-image-1', prompt, size: c.size || '1024x1792', n: 1 }),
  });
  if (!r.ok) throw new Error(`生图接口 ${r.status}`);
  const j = await r.json();
  const item = j.data?.[0] || {};
  if (item.url) return { type: 'url', value: item.url };
  if (item.b64_json) {
    const file = path.join(MEDIA, `${uid('img')}.png`);
    writeFileSync(file, Buffer.from(item.b64_json, 'base64'));
    return { type: 'file', value: `media/${path.basename(file)}` };
  }
  throw new Error('生图接口没给图片');
}

async function callVideo(prompt, image) {
  const c = conf().video;
  if (!c.baseUrl || !c.key) throw new Error('还没配视频接口');
  const r = await fetch(c.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model, prompt, image }),
  });
  if (!r.ok) throw new Error(`视频接口 ${r.status}`);
  return r.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // 静态
    if (req.method === 'GET' && (p === '/' || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css'))) {
      const f = p === '/' ? path.join(PUB, 'index.html') : path.join(PUB, p.replace(/^\//, ''));
      if (existsSync(f)) {
        const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.css') ? 'text/css' : 'text/javascript';
        res.writeHead(200, { 'Content-Type': type });
        res.end(readFileSync(f)); return;
      }
    }
    // 媒体
    if (req.method === 'GET' && p.startsWith('/media/')) {
      const f = path.join(MEDIA, p.replace('/media/', ''));
      if (existsSync(f)) { res.writeHead(200); res.end(readFileSync(f)); return; }
    }

    // 配置
    if (p === '/api/config' && req.method === 'GET') {
      const c = conf();
      const mask = (o) => ({ ...o, key: o.key ? '已配置' : '' });
      return json(res, 200, { script: mask(c.script || {}), image: mask(c.image || {}), video: mask(c.video || {}) });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const b = await body(req);
      const c = conf();
      for (const k of ['script', 'image', 'video']) {
        if (b[k]) {
          c[k] = { ...c[k], ...b[k] };
          if (b[k].key === '已配置' || b[k].key === '') { /* 保留旧 key */ }
        }
      }
      writeJson(CONF, c);
      return json(res, 200, { ok: true });
    }

    // 项目
    if (p === '/api/projects' && req.method === 'GET') return json(res, 200, db().projects);
    if (p === '/api/projects' && req.method === 'POST') {
      const b = await body(req);
      const d = db();
      const proj = { id: uid('p'), name: b.name || '未命名故事', style: b.style || '', story: b.story || '', createdAt: Date.now(), shots: [] };
      d.projects.unshift(proj); save(d);
      return json(res, 200, proj);
    }
    let m = p.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const d = db();
      const i = d.projects.findIndex((x) => x.id === m[1]);
      if (i < 0) return json(res, 404, { error: '没有这个项目' });
      if (req.method === 'GET') return json(res, 200, d.projects[i]);
      if (req.method === 'PUT') { d.projects[i] = { ...d.projects[i], ...(await body(req)) }; save(d); return json(res, 200, d.projects[i]); }
      if (req.method === 'DELETE') { d.projects.splice(i, 1); save(d); return json(res, 200, { ok: true }); }
    }

    // 分镜
    m = p.match(/^\/api\/projects\/([^/]+)\/shots$/);
    if (m && req.method === 'POST') {
      const d = db(); const proj = d.projects.find((x) => x.id === m[1]);
      if (!proj) return json(res, 404, { error: '没有这个项目' });
      const b = await body(req);
      const shot = { id: uid('s'), text: b.text || '', prompt: b.prompt || '', image: '', video: '', status: 'empty' };
      proj.shots.push(shot); save(d); return json(res, 200, shot);
    }
    m = p.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)$/);
    if (m) {
      const d = db(); const proj = d.projects.find((x) => x.id === m[1]);
      if (!proj) return json(res, 404, { error: '没有这个项目' });
      const i = proj.shots.findIndex((x) => x.id === m[2]);
      if (i < 0) return json(res, 404, { error: '没有这个分镜' });
      if (req.method === 'PUT') { proj.shots[i] = { ...proj.shots[i], ...(await body(req)) }; save(d); return json(res, 200, proj.shots[i]); }
      if (req.method === 'DELETE') { proj.shots.splice(i, 1); save(d); return json(res, 200, { ok: true }); }
    }

    // 生成剧本 → 自动拆镜头
    m = p.match(/^\/api\/projects\/([^/]+)\/generate-script$/);
    if (m && req.method === 'POST') {
      const d = db(); const proj = d.projects.find((x) => x.id === m[1]);
      if (!proj) return json(res, 404, { error: '没有这个项目' });
      const text = await callScript(proj.story || proj.name, proj.style);
      const lines = text.split('\n').map((s) => s.replace(/^[\d.、\s-]+/, '').trim()).filter(Boolean);
      proj.shots = lines.map((t) => ({ id: uid('s'), text: t, prompt: t, image: '', video: '', status: 'empty' }));
      save(d);
      return json(res, 200, { ok: true, shots: proj.shots });
    }

    // 出图 / 出视频
    m = p.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/(generate-image|generate-video)$/);
    if (m && req.method === 'POST') {
      const d = db(); const proj = d.projects.find((x) => x.id === m[1]);
      const shot = proj?.shots.find((x) => x.id === m[2]);
      if (!shot) return json(res, 404, { error: '没有这个分镜' });
      try {
        if (m[3] === 'generate-image') {
          const r = await callImage(shot.prompt || shot.text);
          shot.image = r.value; shot.status = 'image';
        } else {
          const r = await callVideo(shot.prompt || shot.text, shot.image);
          shot.video = r.url || r.data?.url || ''; shot.status = 'video';
        }
        save(d); return json(res, 200, shot);
      } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
    }

    return json(res, 404, { error: '没有这个接口' });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('storybench on', PORT));
