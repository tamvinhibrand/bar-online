// Bar Live — server phòng live quán bar cho TikTok LIVE.
// Tách từ "Chánh Điện Online" (MIT, Kent Juno — https://github.com/kentjuno/chanh-dien-online).
// Chạy trên máy phát: phục vụ overlay + bảng điều khiển, đọc sự kiện phòng live TikTok, xếp khách vào bàn,
// quản lý hàng đợi nhạc YouTube, tạo giọng đọc tiếng Việt (Edge TTS) và đẩy mọi thứ sang overlay qua WebSocket.
//
//   cd live && npm install && npm start        → http://localhost:3000/live/control.html
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { parseYouTubeId, parseRequestCommand, RequestMatcher, MusicQueue, fetchVideoInfo } from './music.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');            // thư mục gốc dự án: phục vụ /assets, /live
const TTS_DIR = path.join(__dirname, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
for (const f of fs.readdirSync(TTS_DIR)) { try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch {} }
const PORT = +process.env.PORT || 3000;

/* ------------------------------------------------------------------ trạng thái */
const settings = {
  title: 'SKY BAR',
  subtitle: 'LIVE DJ · QUẨY CÙNG NHAU',
  voice: 'vi-VN-HoaiMyNeural',
  pitch: 0, rate: 0,
  seatMode: 'auto',                  // auto (40 → 60) | 40 | 60
  joinOnEnter: false,                // người chỉ vào phòng (không bình luận) cũng được ngồi
  thankGifts: true,                  // đọc lời cảm ơn khi có quà (không phải yêu cầu bài)
  screen: true,                      // hiện màn hình video YouTube trên sân khấu
  volume: 70,                        // âm lượng nhạc 0..100
  reqPrefix: '!bai',                 // cú pháp yêu cầu bài
  reqMinDiamonds: 30,                // tổng quà tối thiểu để được yêu cầu bài
  reqWindowSec: 120,                 // bình luận lệnh và quà phải cách nhau tối đa bấy nhiêu giây
};
const MAX_SEATS = 60;
const viewers = new Map();           // id -> { id, name, avatar, coins, joinedAt, lastAt, lastText, demo }
const startedAt = Date.now();
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '' };
const log = [];
function addLog(s){ const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${s}`; log.push(line); if (log.length > 300) log.shift(); broadcast({ t:'log', line }, 'control'); console.log(line); }

function capacity(){ if (settings.seatMode !== 'auto') return +settings.seatMode; return viewers.size <= 40 ? 40 : 60; }

function pub(v){ return { id:v.id, name:v.name, avatar:v.avatar||'', coins:v.coins, joinedAt:v.joinedAt, demo:!!v.demo }; }
function snapshot(){ return { t:'state', settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, tiktok: tiktokState, music: musicState() }; }

function seat(id, name, opts = {}){
  // Không xếp chỗ cho người không có ID, tránh lưu khóa undefined vào viewers.
  if (!id) return { v:null, isNew:false };
  id = String(id);
  let v = viewers.get(id);
  if (v){ v.lastAt = Date.now(); if (opts.avatar) v.avatar = opts.avatar; return { v, isNew:false }; }
  if (viewers.size >= MAX_SEATS){                // hết chỗ: khách im lặng lâu nhất mà chưa tặng quà nhường bàn
    const quiet = [...viewers.values()].filter(x => x.coins === 0).sort((a,b) => a.lastAt - b.lastAt)[0];
    if (!quiet) return { v:null, isNew:false };
    viewers.delete(quiet.id); broadcast({ t:'leave', id: quiet.id });
  }
  v = { id, name: (name||id).slice(0, 18), avatar: opts.avatar || '', coins: 0, joinedAt: Date.now(), lastAt: Date.now(), demo: !!opts.demo };
  viewers.set(id, v);
  broadcast({ t:'join', v: pub(v), cap: capacity() });
  return { v, isNew:true };
}

/* ------------------------------------------------------------- sự kiện vào */
function onChat(id, name, text, avatar){
  text = String(text || '').slice(0, 120);
  const { v } = seat(id, name, { avatar });
  if (!v) return;
  v.lastText = text;
  broadcast({ t:'chat', id: v.id, name: v.name, text });
  const q = parseRequestCommand(text, settings.reqPrefix);
  if (q){
    const hit = matcher.command(v.id, q);
    if (hit) addRequest(v, hit.query).catch(e => addLog("Lỗi yêu cầu bài: " + (e?.message || e)));
    else addLog(`🎵 ${v.name} muốn nghe "${q}" (chờ quà ≥ ${settings.reqMinDiamonds} kim cương)`);
  }
}

function onGift(id, name, giftName, count, diamonds, avatar){
  giftName = String(giftName || 'quà').slice(0, 30); count = Math.max(1, Math.min(9999, +count || 1));
  const { v } = seat(id, name, { avatar });
  if (!v) return;
  const coins = Math.max(1, (diamonds || 1) * count);
  v.coins += coins;
  const tier = coins >= 99 ? 3 : coins >= 10 ? 2 : 1;
  broadcast({ t:'gift', id: v.id, name: v.name, giftName, count, coins, total: v.coins, tier });
  const hit = matcher.gift(v.id, coins);
  if (hit) addRequest(v, hit.query).catch(e => addLog("Lỗi yêu cầu bài: " + (e?.message || e)));   // lời thông báo yêu cầu bài thay cho lời cảm ơn
  else if (settings.thankGifts) say(`Cảm ơn ${spoken(v.name)} đã tặng ${giftName}${count > 1 ? ', ' + count + ' lần' : ''}.`, { tag:'gift', id: v.id });
}

const spoken = s => String(s).replace(/[_@.]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'ẩn danh';
// Tên bài để đọc: bỏ phần trong ngoặc như (Official MV), [Lyrics] và phần sau dấu |
const spokenTitle = s => spoken(String(s).replace(/[([{【].*?[)\]}】]/g, ' ').split(/\s[|｜]\s/)[0]).replace(/\s+/g, ' ').trim() || 'theo yêu cầu';

/* ------------------------------------------------------------------- nhạc */
const queue = new MusicQueue();
const matcher = new RequestMatcher({ minDiamonds: settings.reqMinDiamonds, windowSec: settings.reqWindowSec });
setInterval(() => matcher.sweep(), 60_000).unref();
let switchTimer = null, errTimes = [];

function musicState(){ return queue.snapshot(); }
function pushMusic(){ broadcast({ t:'music', ...musicState() }); }

// Chuyển bài kế tiếp và báo cho overlay phát
function playNext(reason){
  clearTimeout(switchTimer); switchTimer = null;
  const cur = queue.next();
  pushMusic();
  if (cur){
    addLog(`▶ Phát: ${cur.title || cur.videoId}${cur.by ? ' · yêu cầu của ' + cur.by : ''}${reason ? ' (' + reason + ')' : ''}`);
    if (cur.kind === 'request') broadcast({ t:'nowplaying', title: cur.title, by: cur.by });
  } else addLog('⏹ Hết nhạc: hàng đợi trống và chưa có nhạc nền');
}
// Có bài yêu cầu sẵn sàng mà đang phát nhạc nền (hoặc im lặng) thì chuyển sau khi đọc xong thông báo
function scheduleSwitch(delayMs = 9000){
  const cur = queue.current;
  if (cur && cur.kind !== 'background') return;   // đang phát bài yêu cầu: bài mới chờ tới lượt
  if (switchTimer) return;
  switchTimer = setTimeout(() => playNext('đến lượt bài yêu cầu'), cur ? delayMs : 300);
}

// Dán link hoặc tên bài → { videoId, title, note }
async function resolveSong(query){
  const videoId = parseYouTubeId(query);
  if (!videoId) return { videoId: null, title: String(query).slice(0, 100), note: 'chờ link' };
  const info = await fetchVideoInfo(videoId);
  if (info.ok) return { videoId, title: info.title || 'Video ' + videoId };
  if (info.reason === 'no-embed') return { videoId: null, title: query, note: 'video chặn nhúng, cần link khác' };
  if (info.reason === 'not-found') return { videoId: null, title: query, note: 'video không tồn tại hoặc riêng tư' };
  return { videoId, title: 'Video ' + videoId };   // mất mạng tạm thời: vẫn thử phát
}

async function addRequest(v, query){
  if (queue.queue.length >= 30){ addLog('Hàng đợi nhạc đã đủ 30 bài, bỏ qua yêu cầu của ' + v.name); return; }
  if (queue.queue.filter(x => x.byId === v.id).length >= 3){ addLog(`${v.name} đã có 3 bài đang chờ, bỏ qua yêu cầu mới`); return; }
  const s = await resolveSong(query);
  const it = queue.add({ videoId: s.videoId, title: s.title, by: v.name, byId: v.id, query });
  it.note = s.note || '';
  addLog(`🎵 Yêu cầu mới: "${it.title}" · ${v.name}${it.note ? ' · ' + it.note : ''}`);
  broadcast({ t:'request', id: it.id, name: v.name, title: it.title });
  say(`Khách hàng ${spoken(v.name)} yêu cầu bài hát ${spokenTitle(it.title)}, sẽ được phát sau đây.`, { tag:'request', id: v.id });
  pushMusic();
  if (it.videoId) scheduleSwitch();
}

async function setBackground(text){
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 50);
  const items = [];
  for (const line of lines){
    const id = parseYouTubeId(line);
    if (!id){ addLog('Nhạc nền: bỏ qua dòng không phải link YouTube: ' + line.slice(0, 60)); continue; }
    const info = await fetchVideoInfo(id);
    if (!info.ok && info.reason !== 'network'){ addLog(`Nhạc nền: bỏ qua ${id} (${info.reason === 'no-embed' ? 'chặn nhúng' : 'không tồn tại'})`); continue; }
    items.push({ videoId: id, title: info.title || 'Video ' + id, url: line });
  }
  queue.setBackground(items);
  addLog(`🎶 Nhạc nền: ${items.length} bài`);
  if (!queue.current || queue.current.kind === 'background') playNext('đổi nhạc nền'); else pushMusic();
}

// overlay báo bài đã hết hoặc lỗi. Chỉ nhận nếu đúng bài đang phát, để 2 overlay cùng mở không chuyển bài 2 lần.
function onPlayer(m){
  const cur = queue.current;
  if (!cur || m.qid !== cur.id) return;
  if (m.ev === 'ended') playNext();
  else if (m.ev === 'error'){
    const code = +m.code || 0;
    const why = { 2:'link sai', 5:'lỗi trình phát', 100:'video bị xóa hoặc riêng tư', 101:'chủ video chặn nhúng', 150:'chủ video chặn nhúng', 153:'thiếu thông tin trang nhúng' }[code] || 'lỗi ' + code;
    addLog(`⚠ Không phát được "${cur.title}": ${why}. Chuyển bài.`);
    // nhạc nền lỗi thì loại khỏi danh sách, nếu không sẽ lặp lại đúng video lỗi đó mãi
    if (cur.kind === 'background'){
      queue.setBackground(queue.background.filter(b => b.videoId !== cur.videoId));
      addLog(`Đã bỏ "${cur.title}" khỏi nhạc nền (còn ${queue.background.length} bài)`);
    }
    // chặn vòng lặp: lỗi liên tục 5 lần trong 30 giây thì dừng phát, chờ admin xử lý
    const now = Date.now(); errTimes = errTimes.filter(x => now - x < 30_000); errTimes.push(now);
    if (errTimes.length >= 5){ errTimes = []; queue.current = null; pushMusic(); addLog('⏹ Lỗi phát liên tục, đã dừng nhạc. Kiểm tra link rồi bấm Phát ngay hoặc Lưu nhạc nền.'); return; }
    playNext();
  }
}

/* ------------------------------------------------------------------ giọng đọc */
const ttsQueue = []; let ttsBusy = false, ttsSeq = 0;
function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function say(text, meta = {}){ if (ttsQueue.length >= 15) { addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 câu'); return; } ttsQueue.push({ text: String(text).slice(0, 500), meta }); pumpTTS(); }
async function synth(text){
  const tts = new MsEdgeTTS();
  await tts.setMetadata(settings.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(esc(text), { pitch: `${settings.pitch >= 0 ? '+' : ''}${settings.pitch}Hz`, rate: `${settings.rate >= 0 ? '+' : ''}${settings.rate}%` });
  const chunks = [];
  try { await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('close', res); audioStream.on('error', rej); }); }
  finally { try { tts.close(); } catch {} }
  return Buffer.concat(chunks);
}
async function pumpTTS(){
  if (ttsBusy || !ttsQueue.length) return; ttsBusy = true;
  const { text, meta } = ttsQueue.shift();
  try {
    // máy chủ Microsoft thỉnh thoảng cắt kết nối giữa chừng: thử lại tối đa 3 lần
    let buf = null, err = null;
    for (let i = 0; i < 3 && !buf; i++){ try { buf = await synth(text); } catch (e) { err = e; await new Promise(r => setTimeout(r, 800)); } }
    if (!buf) throw err;
    const file = `tts_${Date.now()}_${++ttsSeq}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, file), buf);
    broadcast({ t:'tts', url: `/live/tts/${file}`, text, ...meta });
    const old = fs.readdirSync(TTS_DIR).sort(); while (old.length > 40) { try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {} }
  } catch (e) { addLog('TTS lỗi: ' + (e?.message || e)); }
  ttsBusy = false; setTimeout(pumpTTS, 50);
}

/* --------------------------------------------------------------- TikTok */
let TikTokLib = null;
async function connectTikTok(uniqueId){
  uniqueId = String(uniqueId || '').trim().replace(/^.*tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!uniqueId) return;
  await disconnectTikTok();
  tiktokState = { status: 'connecting', uniqueId, error: '' }; broadcast({ t:'tiktok', ...tiktokState });
  try {
    TikTokLib ||= await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TikTokLib;
    // enableExtendedGiftInfo phải tắt: bật lên thì cần chữ ký Euler Stream gói Business trả phí.
    const conn = new TikTokLiveConnection(uniqueId, { enableExtendedGiftInfo: false, processInitialData: false });
    const av = u => u?.profilePicture?.url?.[0] || u?.profilePicture?.urlList?.[0] || u?.avatarThumb?.urlList?.[0] || u?.avatarThumb?.url?.[0] || '';
    // tiktok-live-connector 2.5 (proto v3): user.displayId / user.id, bình luận ở d.content, quà ở d.gift
    const nm = u => u?.nickname || u?.uniqueId || u?.displayId || 'ẩn danh';
    const uid = u => String(u?.uniqueId || u?.displayId || u?.userId || u?.id || '');
    conn.on(WebcastEvent.CHAT, d => onChat(uid(d.user), nm(d.user), d.comment ?? d.content, av(d.user)));
    conn.on(WebcastEvent.GIFT, d => {
      const g = d.gift || d.giftDetails || d.extendedGiftInfo || {};
      const type = g.type ?? g.giftType;
      if (type === 1 && !d.repeatEnd) return;                       // quà combo chưa kết thúc
      const gname = g.name || g.giftName || 'quà';
      const dia = g.diamondCount ?? g.diamond_count ?? 1;
      onGift(uid(d.user), nm(d.user), gname, d.repeatCount || 1, dia, av(d.user));
      addLog(`🎁 ${nm(d.user)} tặng ${gname} x${d.repeatCount || 1} (${dia} kim cương/quà)`);
    });
    conn.on(WebcastEvent.MEMBER, d => { if (settings.joinOnEnter) seat(uid(d.user), nm(d.user), { avatar: av(d.user) }); });
    conn.on(WebcastEvent.LIKE, d => broadcast({ t:'like', id: uid(d.user), n: d.likeCount || 1 }));
    conn.on(ControlEvent.DISCONNECTED, () => { tiktokState = { ...tiktokState, status: 'disconnected' }; broadcast({ t:'tiktok', ...tiktokState }); addLog('TikTok: mất kết nối'); });
    conn.on(ControlEvent.ERROR, e => addLog('TikTok lỗi: ' + (e?.info || e?.message || e)));
    const st = await conn.connect();
    tiktok = conn;
    tiktokState = { status: 'connected', uniqueId, error: '', roomId: st?.roomId || '' };
    addLog(`✅ Đã kết nối live @${uniqueId}`);
  } catch (e) {
    tiktokState = { status: 'error', uniqueId, error: String(e?.message || e) };
    addLog(`❌ Không kết nối được @${uniqueId}: ${tiktokState.error}`);
  }
  broadcast({ t:'tiktok', ...tiktokState });
}
async function disconnectTikTok(){ if (tiktok){ try { await tiktok.disconnect(); } catch {} tiktok = null; } tiktokState = { status:'idle', uniqueId:'', error:'' }; broadcast({ t:'tiktok', ...tiktokState }); }

/* ------------------------------------------------------------- dữ liệu thử */
const DEMO_NAMES = ['Tuấn Hưng','Minh Thư','Bảo Anh','Quốc Khánh','Ngọc Trinh','Hoàng Nam','Thùy Linh','Đức Phúc','Lan Ngọc','Gia Huy','Khánh Vy','Trung Kiên',
  'Mai Phương','Thành Đạt','Hải Yến','Văn Toàn','Phương Ly','Quang Hải','Kim Ngân','Tiến Dũng','Bích Phương','Đình Trọng','Yến Nhi','Công Phượng','Hà Anh','Duy Mạnh'];
function fillDemo(n){
  const have = [...viewers.values()].filter(v => v.demo).length;
  for (let i = have; i < n && viewers.size < MAX_SEATS; i++){
    const name = DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ' ' + (Math.floor(i / DEMO_NAMES.length) + 1) : '');
    seat('demo_' + i, name, { demo: true });
  }
}
function clearSeats(){ viewers.clear(); broadcast(snapshot()); addLog('Đã dọn trống các bàn'); }

/* ------------------------------------------------------------- điều khiển */
async function onControl(m){
  switch (m.cmd){
    case 'connect': connectTikTok(m.uniqueId); break;
    case 'disconnect': disconnectTikTok(); addLog('Đã ngắt kết nối TikTok'); break;
    case 'chat': { const n = String(m.name || 'Khách').slice(0, 18); onChat('sim_' + n, n, String(m.text || 'Quẩy lên!').slice(0, 120)); break; }
    case 'gift': { const n = String(m.name || 'Khách').slice(0, 18); onGift('sim_' + n, n, String(m.gift || 'Hoa hồng').slice(0, 30), clamp(m.count, 1, 99), clamp(m.diamonds, 1, 50000)); break; }
    case 'fill': fillDemo(clamp(m.n, 1, MAX_SEATS)); addLog(`Đổ khách mẫu: ${viewers.size} người`); break;
    case 'clear': clearSeats(); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say' }); break;
    case 'settings': {
      const prevCap = capacity();
      applySettings(m.settings || {});
      matcher.minDiamonds = settings.reqMinDiamonds; matcher.windowSec = settings.reqWindowSec;
      broadcast({ t:'settings', settings, cap: capacity() });
      if (prevCap !== capacity()) addLog(`Số chỗ: ${capacity()}`);
      break;
    }
    case 'bots': setBots(!!m.on, +m.n || 12, m.pace); break;
    // ---- nhạc
    case 'musicBg': await setBackground(m.text); break;
    case 'musicSkip': playNext('admin bỏ qua'); break;
    case 'musicPlay': {                              // phát ngay một link bất kỳ
      const s = await resolveSong(String(m.url || ''));
      if (!s.videoId){ addLog('Không phát được link này: ' + (s.note || 'không phải link YouTube')); break; }
      clearTimeout(switchTimer); switchTimer = null;
      queue.playDirect({ videoId: s.videoId, title: s.title }); pushMusic(); addLog(`▶ Admin phát ngay: ${s.title}`); break;
    }
    case 'musicAdd': {                               // admin thêm bài vào cuối hàng đợi
      const s = await resolveSong(String(m.url || ''));
      if (!s.videoId){ addLog('Không thêm được: ' + (s.note || 'không phải link YouTube')); break; }
      queue.add({ videoId: s.videoId, title: s.title, by: 'Admin', kind: 'admin' }); pushMusic(); scheduleSwitch(300); break;
    }
    case 'musicSetLink': {                           // admin dán/đổi link cho một yêu cầu
      const it = queue.get(String(m.id)); if (!it) break;
      const s = await resolveSong(String(m.url || ''));
      if (!s.videoId){ addLog(`Link cho "${it.title}" không dùng được: ${s.note || 'không phải link YouTube'}`); break; }
      queue.update(it.id, { videoId: s.videoId, title: s.title }); it.note = '';
      addLog(`🔗 Đã gắn link cho yêu cầu của ${it.by || 'khách'}: ${s.title}`); pushMusic(); scheduleSwitch(300); break;
    }
    case 'musicMove': if (queue.move(String(m.id), +m.dir)) pushMusic(); break;
    case 'musicRemove': if (queue.remove(String(m.id))) pushMusic(); break;
    case 'musicPlayNow': if (queue.playNow(String(m.id))){ clearTimeout(switchTimer); switchTimer = null; pushMusic(); const c = queue.current; addLog(`▶ Phát ngay: ${c.title}`); if (c.kind === 'request') broadcast({ t:'nowplaying', title: c.title, by: c.by }); } break;
  }
}

// Chỉ nhận đúng khóa, đúng kiểu, trong giới hạn: bảng điều khiển chạy trên máy mình nhưng không tin mù dữ liệu từ socket.
const SETTING_RULES = {
  title: v => String(v).slice(0, 30), subtitle: v => String(v).slice(0, 60),
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50), rate: v => clamp(v, -50, 50),
  joinOnEnter: Boolean, thankGifts: Boolean, screen: Boolean,
  volume: v => clamp(v, 0, 100),
  seatMode: v => ['auto', '40', '60'].includes(String(v)) ? String(v) : 'auto',
  reqPrefix: v => { const s = String(v).trim().slice(0, 12); return /^\S+$/.test(s) ? s : settings.reqPrefix; },
  reqMinDiamonds: v => clamp(v, 1, 50000), reqWindowSec: v => clamp(v, 10, 600),
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
function applySettings(o){ for (const [k, fn] of Object.entries(SETTING_RULES)) if (k in o) settings[k] = fn(o[k]); }

/* ----------------------------------------------------------------- bot */
let botTimer = null;
const BOT_LINES = ['Quẩy lên anh em ơi', 'DJ đỉnh quá', 'Nhạc cháy thật sự', 'Cho xin 1 bài remix', 'Chào cả nhà', 'Bàn này còn chỗ không', 'Bass đập mạnh quá',
  'Hôm nay vui quá', 'Cạn ly nào', 'Nghe là muốn nhảy', 'DJ xinh quá', 'Ai từ Sài Gòn điểm danh'];
// Ký hiệu nhận biết khách do bot mô phỏng. Giọng đọc tự bỏ qua emoji nên không đọc ký hiệu này.
const BOT_MARK = '🤖';
function setBots(on, n, pace){
  clearInterval(botTimer); botTimer = null;
  if (on){
    n = clamp(n, 1, MAX_SEATS);
    for (let i = 0; i < n; i++) seat('bot_' + i, DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ' + BOT_MARK, { demo: true });
    const every = { slow: 4000, mid: 1800, fast: 700 }[pace] || 1800;
    botTimer = setInterval(() => {
      const ids = [...viewers.keys()].filter(id => String(id).startsWith('bot_')); if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)], v = viewers.get(id), r = Math.random();
      if (r < .62) onChat(id, v.name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
      else if (r < .9) broadcast({ t:'like', id, n: 1 + Math.floor(Math.random() * 4) });
      else if (r < .985) onGift(id, v.name, 'Hoa hồng', 1 + Math.floor(Math.random() * 3), 1);
      else onGift(id, v.name, 'Ly bia', 1, 30);
    }, every);
    addLog(`🤖 Bật ${n} bot, nhịp ${pace}`);
  } else {
    for (const id of [...viewers.keys()]) if (String(id).startsWith('bot_')) { viewers.delete(id); broadcast({ t:'leave', id }); }
    addLog('🤖 Tắt bot');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- server */
// Bảo mật (giữ nguyên các lớp của bản gốc):
//  • chỉ nghe 127.0.0.1; máy khác trong mạng / Internet không vào được trừ khi cố ý đặt HOST
//  • header Host phải là localhost/127.0.0.1 (chống DNS rebinding)
//  • WebSocket chỉ nhận trang do chính server phục vụ (kiểm tra Origin)
//  • file tĩnh: chỉ /assets và /live, không file ẩn, không node_modules, không mã server, không ../
//  • overlay chỉ được gửi 1 loại tin: báo trạng thái trình phát (hết bài / lỗi) cho đúng bài đang phát
//  • không dùng mật khẩu, cookie hay session TikTok
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.mp3':'audio/mpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const okHost = h => ALLOWED_HOSTS.has(String(h || '').toLowerCase());
const SEP = path.sep;
function resolveStatic(urlPath){
  let p = urlPath === '/' ? '/live/control.html' : urlPath;
  if (!/^\/(assets|live)\//.test(p)) return null;
  if (p.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules' || seg === 'test')) return null;
  if (/\.(mjs|json|md|log)$/i.test(p) && !p.startsWith('/assets/')) return null;      // không bao giờ phục vụ mã server / package
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + SEP)) return null;
  return file;
}
const server = http.createServer((req, res) => {
  if (!okHost(req.headers.host)) { res.writeHead(421).end('wrong host'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = resolveStatic(p);
  if (!file) { res.writeHead(404).end('not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/live/tts/') ? 'no-store' : 'no-cache', 'X-Content-Type-Options': 'nosniff',
      // YouTube nhúng yêu cầu trang gửi kèm Referer (thiếu sẽ báo lỗi 153), nên không dùng no-referrer ở đây.
      // Ảnh đại diện TikTok trong overlay vẫn tự đặt referrerPolicy = no-referrer.
      'Referrer-Policy': 'strict-origin-when-cross-origin' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }) => {
    if (!okHost(req.headers.host)) return false;
    if (!origin) return true;                                   // OBS / client không phải trình duyệt không gửi Origin
    try { return okHost(new URL(origin).host); } catch { return false; }
  } });
function broadcast(msg, only){ const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1 && (!only || c.role === only)) c.send(s); }
wss.on('connection', (ws, req) => {
  ws.role = new URL(req.url, 'http://x').searchParams.get('role') === 'control' ? 'control' : 'overlay';
  ws.send(JSON.stringify(snapshot()));
  if (ws.role === 'control') ws.send(JSON.stringify({ t:'logs', lines: log }));
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (ws.role === 'overlay'){                                 // overlay chỉ được báo trạng thái trình phát
      if (m.t === 'player' && (m.ev === 'ended' || m.ev === 'error')) onPlayer({ ev: m.ev, qid: String(m.qid || ''), code: m.code });
      return;
    }
    if (m.t === 'ctl') Promise.resolve(onControl(m)).catch(e => addLog('Lệnh lỗi: ' + (e?.message || e)));
  });
});
server.listen(PORT, HOST, () => addLog(`Server chạy tại http://localhost:${PORT}  ·  Bảng điều khiển: http://localhost:${PORT}/live/control.html  ·  Overlay: http://localhost:${PORT}/live/overlay.html`));
