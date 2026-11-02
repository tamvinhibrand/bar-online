# Bar Live: chạy trên Windows (Laragon + Git Bash)

Phòng live quán bar cho TikTok LIVE: https://github.com/tamvinhibrand/bar-online
Dựa trên mã nguồn mở Chánh Điện Online (MIT) của Kent Juno.

Các lệnh dưới đây chạy trong **Git Bash**. Ví dụ dùng thư mục `D:\laragon\www\bar-online`; đổi theo máy bạn.

## 0. Tải mã nguồn

    cd /d/laragon/www
    git clone https://github.com/tamvinhibrand/bar-online.git

Lấy bản mới sau này: `cd /d/laragon/www/bar-online && git pull && cd live && npm install`

## 1. Cài và chạy

    cd /d/laragon/www/bar-online/live
    node -v          # cần v20 trở lên
    npm install      # lần đầu
    npm test         # chạy test phần nhạc (11 test)
    npm start

Mở bảng điều khiển: http://localhost:3000/live/control.html
Đổi cổng nếu 3000 đang bận (ví dụ đang chạy Chánh Điện): `PORT=3100 npm start`

## 2. Overlay

- Cửa sổ trình duyệt: bấm "Mở màn hình overlay 9:16", rồi bấm "Bật âm thanh" một lần.
- OBS: Browser source, URL `http://localhost:3000/live/overlay.html?obs=1`, kích thước 1080×1920, bật "Control audio via OBS".
- TikTok LIVE Studio: Window capture không thu tiếng trình duyệt, cần thêm nguồn âm thanh máy tính.

## 3. Nhạc

- **Nhạc nền:** dán các link YouTube (mỗi dòng một link) rồi bấm "Lưu nhạc nền". Khi không có yêu cầu, nhạc nền phát lặp vòng.
- **Phát ngay / Thêm vào hàng đợi:** dán một link bất kỳ.
- **Khách yêu cầu bài:** bình luận `!bai Tên bài` rồi tặng quà tổng ≥ 30 kim cương trong 120 giây (tặng trước rồi bình luận sau cũng được). Live đọc: "Khách hàng [tên] yêu cầu bài hát [tên bài], sẽ được phát sau đây."
  - TikTok thường chặn link trong bình luận, nên khách hay chỉ gõ tên bài. Khi đó yêu cầu hiện "chờ link" trong hàng đợi: dán link vào ô của yêu cầu đó, bấm "Lưu link".
  - Đang phát nhạc nền mà có yêu cầu sẵn link thì chuyển sang bài yêu cầu sau khoảng 9 giây (đọc xong thông báo). Đang phát bài yêu cầu khác thì chờ tới lượt.
- Đổi cú pháp, ngưỡng quà, thời gian ghép trong mục "Luật yêu cầu bài".

## 4. Video không phát được

Nhiều MV chính thức (nhất là kênh VEVO, hãng đĩa lớn) chặn phát nhúng ngoài YouTube. Gặp video như vậy server ghi nhật ký "chủ video chặn nhúng", bỏ qua và phát bài kế. Nếu là nhạc nền thì video đó bị loại khỏi danh sách. Nên chọn bản lyric, bản remix hoặc video từ kênh cho phép nhúng.

## 5. Bản quyền

TikTok tự quét nhạc trong live. Phát nhạc thương mại có thể bị tắt tiếng, cảnh báo hoặc dừng live. Phần này code không xử lý được.

## 6. Ảnh

Xem `assets/README.md`: đặt `bar_bg.jpg` và `dj.png` vào thư mục `assets/` là overlay tự dùng.
