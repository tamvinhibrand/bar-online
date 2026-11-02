// Test phần nhạc: chạy bằng `npm test` (node --test), không cần mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId, parseRequestCommand, RequestMatcher, MusicQueue, fetchVideoInfo } from '../music.mjs';

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeId: các dạng link hợp lệ', () => {
  for (const s of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s&list=PL1`, `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`, `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}?feature=share`, ID, `  ${ID}  `,
  ]) assert.equal(parseYouTubeId(s), ID, s);
});

test('parseYouTubeId: từ chối link không phải YouTube hoặc ID sai', () => {
  for (const s of ['', null, 'hello', 'https://vimeo.com/123', `https://evil.com/watch?v=${ID}`, `https://youtube.com.evil.com/watch?v=${ID}`,
    'https://youtu.be/short', 'https://www.youtube.com/watch?v=bad!id!here', 'https://www.youtube.com/channel/UCabc'])
    assert.equal(parseYouTubeId(s), null, String(s));
});

test('parseRequestCommand: đọc lệnh có dấu, không dấu, hoa thường', () => {
  assert.equal(parseRequestCommand('!bai Nơi này có anh'), 'Nơi này có anh');
  assert.equal(parseRequestCommand('!bài: Hãy trao cho anh'), 'Hãy trao cho anh');
  assert.equal(parseRequestCommand('!BAI   See tình  '), 'See tình');
  assert.equal(parseRequestCommand(`!bai https://youtu.be/${ID}`), `https://youtu.be/${ID}`);
  assert.equal(parseRequestCommand('!song Faded', '!song'), 'Faded');
});

test('parseRequestCommand: không phải lệnh', () => {
  for (const s of ['bai nay hay qua', '!bai', '!bai   ', '!bainao hay', 'xin !bai abc', '', null]) assert.equal(parseRequestCommand(s), null, String(s));
});

test('RequestMatcher: lệnh trước, quà sau, đủ ngưỡng', () => {
  let t = 0; const m = new RequestMatcher({ minDiamonds: 30, windowSec: 120, now: () => t });
  assert.equal(m.command('u1', 'Bài A'), null);
  t = 10_000; assert.equal(m.gift('u1', 10), null);                      // chưa đủ
  t = 20_000; assert.deepEqual(m.gift('u1', 20), { userId: 'u1', query: 'Bài A' });   // cộng dồn 30
  t = 30_000; assert.equal(m.gift('u1', 100), null);                     // lệnh đã dùng, quà sau không tạo yêu cầu mới
});

test('RequestMatcher: quà trước, lệnh sau', () => {
  let t = 0; const m = new RequestMatcher({ minDiamonds: 30, windowSec: 120, now: () => t });
  assert.equal(m.gift('u2', 99), null);
  t = 60_000; assert.deepEqual(m.command('u2', 'Bài B'), { userId: 'u2', query: 'Bài B' });
});

test('RequestMatcher: quá thời gian thì không ghép', () => {
  let t = 0; const m = new RequestMatcher({ minDiamonds: 30, windowSec: 120, now: () => t });
  m.command('u3', 'Bài C');
  t = 121_000; assert.equal(m.gift('u3', 50), null);
  m.gift('u4', 50); t = 300_000; assert.equal(m.command('u4', 'Bài D'), null);
  m.sweep(); assert.equal(m.credit.has('u3'), false);
});

test('RequestMatcher: khách khác nhau không lẫn quà', () => {
  const m = new RequestMatcher({ minDiamonds: 30, now: () => 0 });
  m.command('a', 'Bài A');
  assert.equal(m.gift('b', 100), null);
});

test('MusicQueue: ưu tiên yêu cầu có link, bỏ qua yêu cầu chưa có link, rồi về nhạc nền', () => {
  const q = new MusicQueue();
  q.setBackground([{ videoId: 'bgbgbgbgbg1', title: 'Nền 1' }, { videoId: 'bgbgbgbgbg2', title: 'Nền 2' }]);
  const a = q.add({ query: 'Chưa có link', by: 'A' });
  const b = q.add({ videoId: ID, title: 'Có link', by: 'B' });
  assert.equal(q.next().id, b.id);
  assert.equal(q.next().videoId, 'bgbgbgbgbg1');          // a vẫn chờ link
  assert.equal(q.next().videoId, 'bgbgbgbgbg2');
  assert.equal(q.next().videoId, 'bgbgbgbgbg1');          // nhạc nền lặp vòng
  q.update(a.id, { videoId: ID, title: 'Đã có link' });
  assert.equal(q.next().title, 'Đã có link');
  assert.equal(q.queue.length, 0);
});

test('MusicQueue: đổi thứ tự, xóa, phát ngay, rỗng', () => {
  const q = new MusicQueue();
  assert.equal(q.next(), null);
  const a = q.add({ videoId: ID, title: 'A' }), b = q.add({ videoId: ID, title: 'B' }), c = q.add({ videoId: ID, title: 'C' });
  assert.equal(q.move(c.id, -1), true); assert.deepEqual(q.queue.map(x => x.title), ['A', 'C', 'B']);
  assert.equal(q.move(a.id, -1), false);
  assert.equal(q.remove(b.id), true); assert.equal(q.remove('khong-co'), false);
  assert.equal(q.playNow(c.id).title, 'C'); assert.deepEqual(q.queue.map(x => x.title), ['A']);
  assert.equal(q.playDirect({ videoId: ID, title: 'Admin' }).kind, 'admin');
});

test('fetchVideoInfo: đọc tên bài và nhận biết video chặn nhúng', async () => {
  const fake = (status, body) => async url => { assert.match(url, /^https:\/\/www\.youtube\.com\/oembed\?/); return { status, ok: status === 200, json: async () => body }; };
  assert.deepEqual(await fetchVideoInfo(ID, fake(200, { title: 'Bài hát', author_name: 'Ca sĩ' })), { ok: true, title: 'Bài hát', author: 'Ca sĩ' });
  assert.deepEqual(await fetchVideoInfo(ID, fake(401, {})), { ok: false, reason: 'no-embed' });
  assert.deepEqual(await fetchVideoInfo(ID, fake(404, {})), { ok: false, reason: 'not-found' });
  assert.deepEqual(await fetchVideoInfo(ID, async () => { throw new Error('offline'); }), { ok: false, reason: 'network' });
  assert.deepEqual(await fetchVideoInfo('../etc', fake(200, {})), { ok: false, reason: 'bad-id' });
});
