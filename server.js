// MiuFy server: busca en YouTube y entrega solo el AUDIO (con soporte Range) para reproducir en segundo plano.
const http = require('http'), https = require('https'), { execFile } = require('child_process');
const PORT = process.env.PORT || 8080, KEY = process.env.API_KEY || '', COOKIES = process.env.COOKIES_FILE || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range' };
const audioCache = new Map(), searchCache = new Map();

function ytdlp(args) {
  const base = ['--no-warnings']; if (COOKIES) base.push('--cookies', COOKIES);
  return new Promise((resolve, reject) => {
    const run = (extra) => execFile('yt-dlp', [...base, ...extra, ...args], { maxBuffer: 30e6, timeout: 30000 }, (e, out, err) => {
      if (e) { if (extra.length && /no such option/i.test(err || '')) return run([]); return reject(new Error((err || e.message).slice(0, 300))); }
      resolve(out.trim());
    });
    run(['--js-runtimes', 'node']);
  });
}

async function search(q) {
  const hit = searchCache.get(q); if (hit && Date.now() - hit.t < 600000) return hit.v;
  const out = await ytdlp(['--flat-playlist', '-J', 'ytsearch14:' + q]);
  const items = (JSON.parse(out).entries || []).filter(x => x && x.id && (!x.duration || x.duration < 600)).map(x => ({
    id: x.id, title: x.title || '', artist: (x.channel || x.uploader || '').replace(/ - Topic$/, ''),
    dur: x.duration || 0, thumb: 'https://i.ytimg.com/vi/' + x.id + '/hqdefault.jpg'
  }));
  searchCache.set(q, { t: Date.now(), v: items }); return items;
}

function proxy(req, res, url, retry, id, hops = 0) {
  const u = new URL(url), h = { 'user-agent': 'Mozilla/5.0' }; if (req.headers.range) h.range = req.headers.range;
  https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: h }, up => {
    if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location && hops < 3) { up.resume(); return proxy(req, res, up.headers.location, retry, id, hops + 1); }
    if (up.statusCode >= 400 && retry) { audioCache.delete(id); up.resume(); return stream(req, res, id, false); }
    const o = { ...CORS }; ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(k => { if (up.headers[k]) o[k] = up.headers[k]; });
    res.writeHead(up.statusCode, o); up.pipe(res); req.on('close', () => up.destroy());
  }).on('error', () => { if (!res.headersSent) { res.writeHead(502, CORS); res.end(); } });
}

async function stream(req, res, id, retry) {
  try {
    let c = audioCache.get(id);
    if (!c || Date.now() - c.t > 3 * 3600e3) {
      const out = await ytdlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', 'https://www.youtube.com/watch?v=' + id]);
      c = { u: out.split('\n')[0], t: Date.now() }; audioCache.set(id, c);
    }
    proxy(req, res, c.u, retry, id);
  } catch (e) { res.writeHead(502, { ...CORS, 'content-type': 'text/plain' }); res.end(String(e.message)); }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (u.pathname === '/') { res.writeHead(200, CORS); return res.end('ok'); }
  if (KEY && u.searchParams.get('k') !== KEY) { res.writeHead(401, CORS); return res.end(); }
  let m;
  if ((m = u.pathname.match(/^\/audio\/([\w-]{11})$/))) return stream(req, res, m[1], true);
  if (u.pathname === '/search') {
    try { const r = await search((u.searchParams.get('q') || '').slice(0, 120)); res.writeHead(200, { ...CORS, 'content-type': 'application/json' }); return res.end(JSON.stringify(r)); }
    catch (e) { res.writeHead(502, CORS); return res.end(String(e.message)); }
  }
  res.writeHead(404, CORS); res.end();
}).listen(PORT, () => console.log('MiuFy server en puerto ' + PORT));
