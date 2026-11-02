// Bar Live — phần nhạc: đọc link YouTube, đọc lệnh yêu cầu bài, ghép bình luận với quà, hàng đợi phát.
// File này không phụ thuộc server/TikTok để test riêng được bằng `node --test`.

/* ------------------------------------------------------------ link YouTube */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Lấy video ID (11 ký tự) từ mọi dạng link YouTube phổ biến. Trả null nếu không phải link YouTube hợp lệ.
//   https://www.youtube.com/watch?v=ID   https://youtu.be/ID   https://youtube.com/shorts/ID
//   https://www.youtube.com/embed/ID     https://www.youtube.com/live/ID   https://music.youtube.com/watch?v=ID
//   hoặc chỉ dán đúng ID
export function parseYouTubeId(input){
  const s = String(input || '').trim();
  if (!s) return null;
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com'){
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/); if (m) id = m[2]; }
  }
  return id && ID_RE.test(id) ? id : null;
}

/* ------------------------------------------------------- lệnh yêu cầu bài */
// Bình luận dạng "!bai Tên bài" hoặc "!bài: link". Trả phần sau lệnh (đã cắt gọn), hoặc null nếu không phải lệnh.
export function parseRequestCommand(text, prefix = '!bai'){
  const t = String(text || '').trim().normalize('NFC');
  if (!t) return null;
  // chấp nhận cả có dấu / không dấu và viết hoa: !bai, !bài, !BAI
  const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const p = strip(String(prefix || '!bai').trim());
  if (!p) return null;
  const head = strip(t.slice(0, p.length));
  if (head !== p) return null;
  const rest = t.slice(p.length);
  if (rest && !/^[\s:：-]/.test(rest)) return null;          // "!bainao" không phải lệnh
  const q = rest.replace(/^[\s:：-]+/, '').trim().slice(0, 100);
  return q || null;
}

/* ------------------------------------------- ghép lệnh với quà trong N giây */
// Khách có thể bình luận lệnh trước rồi tặng quà, hoặc tặng quà trước rồi bình luận lệnh.
// Chỉ quà đạt ngưỡng (cộng dồn trong cửa sổ thời gian) mới đổi được thành yêu cầu bài.
export class RequestMatcher {
  constructor({ minDiamonds = 30, windowSec = 120, now = () => Date.now() } = {}){
    this.minDiamonds = minDiamonds; this.windowSec = windowSec; this.now = now;
    this.cmds = new Map();     // userId -> { query, at }
    this.credit = new Map();   // userId -> { coins, at }
  }
  _fresh(x){ return x && this.now() - x.at <= this.windowSec * 1000; }
  // gọi khi có bình luận lệnh; trả về yêu cầu nếu khách đã tặng đủ quà trước đó
  command(userId, query){
    const c = this.credit.get(userId);
    if (this._fresh(c) && c.coins >= this.minDiamonds){ this.credit.delete(userId); this.cmds.delete(userId); return { userId, query }; }
    this.cmds.set(userId, { query, at: this.now() });
    return null;
  }
  // gọi khi có quà; trả về yêu cầu nếu khách đã có lệnh còn hạn và tổng quà đạt ngưỡng
  gift(userId, coins){
    let c = this.credit.get(userId);
    if (!this._fresh(c)) c = { coins: 0, at: this.now() };
    c.coins += Math.max(0, +coins || 0); c.at = this.now();
    const cmd = this.cmds.get(userId);
    if (this._fresh(cmd) && c.coins >= this.minDiamonds){ this.cmds.delete(userId); this.credit.delete(userId); return { userId, query: cmd.query }; }
    this.credit.set(userId, c);
    return null;
  }
  // dọn bản ghi hết hạn để bộ nhớ không phình khi live lâu
  sweep(){ for (const m of [this.cmds, this.credit]) for (const [k, v] of m) if (!this._fresh(v)) m.delete(k); }
}

/* -------------------------------------------------------------- hàng đợi */
// item: { id, videoId|null, title, by, byId, query, kind: 'request'|'admin', addedAt }
// - Yêu cầu chưa có link (khách chỉ gõ tên bài) nằm chờ, bị bỏ qua khi chọn bài kế tiếp cho tới khi admin dán link.
// - Hết yêu cầu thì quay về danh sách nhạc nền của admin (lặp vòng).
export class MusicQueue {
  constructor(){ this.queue = []; this.current = null; this.background = []; this.bgIndex = 0; this.seq = 0; }
  _item(o){ return { id: 'q' + (++this.seq), videoId: o.videoId || null, title: String(o.title || o.query || '').slice(0, 120),
    by: o.by || '', byId: o.byId || '', query: o.query || '', kind: o.kind || 'request', addedAt: Date.now() }; }
  add(o){ const it = this._item(o); this.queue.push(it); return it; }
  get(id){ return this.queue.find(x => x.id === id) || null; }
  update(id, patch){
    const it = this.get(id); if (!it) return null;
    if ('videoId' in patch) it.videoId = patch.videoId || null;
    if ('title' in patch && patch.title) it.title = String(patch.title).slice(0, 120);
    return it;
  }
  remove(id){ const i = this.queue.findIndex(x => x.id === id); if (i < 0) return false; this.queue.splice(i, 1); return true; }
  move(id, dir){
    const i = this.queue.findIndex(x => x.id === id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= this.queue.length) return false;
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; return true;
  }
  setBackground(items){ this.background = items.filter(x => x && x.videoId).slice(0, 50); this.bgIndex = 0; }
  // chọn bài kế tiếp: yêu cầu đầu tiên đã có link, nếu không có thì nhạc nền
  next(){
    const i = this.queue.findIndex(x => x.videoId);
    if (i >= 0){ this.current = this.queue.splice(i, 1)[0]; return this.current; }
    if (this.background.length){
      const b = this.background[this.bgIndex++ % this.background.length];
      this.current = { ...b, id: 'bg' + (++this.seq), kind: 'background' }; return this.current;
    }
    this.current = null; return null;
  }
  // admin bấm "Phát ngay": đưa bài lên phát luôn
  playNow(id){ const i = this.queue.findIndex(x => x.id === id && x.videoId); if (i < 0) return null; this.current = this.queue.splice(i, 1)[0]; return this.current; }
  playDirect(o){ this.current = this._item({ ...o, kind: 'admin' }); return this.current; }
  snapshot(){ return { current: this.current, queue: this.queue.slice(0, 50), background: this.background }; }
}

/* -------------------------------------------------------- tên bài (oEmbed) */
// Lấy tên video qua oEmbed của YouTube (không cần API key). YouTube trả 401 khi video chặn nhúng,
// 404/400 khi video riêng tư hoặc không tồn tại. fetchFn tiêm vào được để test không cần mạng.
export async function fetchVideoInfo(videoId, fetchFn = globalThis.fetch, timeoutMs = 6000){
  if (!ID_RE.test(String(videoId || ''))) return { ok: false, reason: 'bad-id' };
  const url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ac.signal });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'no-embed' };
    if (!r.ok) return { ok: false, reason: 'not-found' };
    const j = await r.json();
    return { ok: true, title: String(j.title || '').slice(0, 120), author: String(j.author_name || '').slice(0, 60) };
  } catch { return { ok: false, reason: 'network' }; }
  finally { clearTimeout(timer); }
}
