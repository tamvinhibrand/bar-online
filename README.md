# Bar Live

Phòng live quán bar 9:16 cho TikTok LIVE. Người xem bình luận là được vào ngồi bàn, ai tặng nhiều được lên bàn VIP sát sân khấu. Trên sân khấu có DJ và màn hình LED phát nhạc YouTube. Khách tặng quà kèm lệnh `!bai` để yêu cầu bài hát, giọng đọc tiếng Việt thông báo: *"Khách hàng [tên] yêu cầu bài hát [tên bài], sẽ được phát sau đây."* Admin đổi link, sắp xếp hàng đợi ngay trên bảng điều khiển.

Mã nguồn: https://github.com/tamvinhibrand/bar-online

| Thư mục | Là gì |
|---|---|
| `live/` | Server Node, overlay 9:16, bảng điều khiển, phần nhạc (`music.mjs`) và test |
| `assets/` | Ảnh DJ (`dj.png`), ảnh nền quán bar (`bar_bg.jpg`, tùy chọn) và hướng dẫn tạo ảnh |


## Chạy trên máy phát

Cần Node.js 20 trở lên.

```bash
git clone https://github.com/tamvinhibrand/bar-online.git
cd bar-online/live
npm install
npm test        # test phần nhạc
npm start
```

1. Mở `http://localhost:3000/live/control.html` (bảng điều khiển). Cổng 3000 đang bận thì chạy `PORT=3100 npm start`.
2. Bấm **Mở màn hình overlay 9:16**, rồi bấm **Bật âm thanh** một lần trong cửa sổ đó (trình duyệt chặn tự phát tiếng).
3. Đưa lên live:
   - **OBS:** *Browser source* trỏ tới `http://localhost:3000/live/overlay.html?obs=1`, kích thước 1080×1920, bật *Control audio via OBS*. Tham số `?obs=1` bỏ nút bật âm thanh.
   - **TikTok LIVE Studio:** *Add source → Window capture* → chọn cửa sổ overlay. Cách này không thu tiếng trình duyệt, cần thêm nguồn âm thanh máy tính.
4. Bật LIVE trên TikTok, nhập `@username` vào bảng điều khiển, bấm **Kết nối**.

Chưa live vẫn thử được: dùng **Thử tương tác**, **Đổ khách mẫu 10/20/40/60** hoặc **Bot mô phỏng**.

Hướng dẫn chi tiết trên Windows với Laragon + Git Bash: xem [`SETUP-LOCAL.md`](SETUP-LOCAL.md).

## Người xem làm được gì

- **Bình luận bất kỳ:** được vào ngồi bàn. Mặc định 10 bàn × 4 ghế, đông hơn 40 người thì tự mở 15 bàn × 4 ghế. Đầy chỗ thì khách im lặng lâu nhất mà chưa tặng quà sẽ nhường chỗ.
- **Tặng quà:** banner xướng tên, giọng đọc cảm ơn, pháo giấy và đèn laser theo giá trị quà. Khách tặng nhiều nhất được xếp lên **bàn VIP** hàng đầu, có vương miện và lên **Bảng VIP**.
- **Yêu cầu bài hát:** bình luận `!bai Tên bài` (hoặc `!bai` + link YouTube), rồi tặng quà tổng từ **30 kim cương** trong vòng **120 giây**. Tặng quà trước rồi bình luận sau cũng được, quà nhỏ được cộng dồn. Mỗi khách tối đa 3 bài đang chờ.
- **Thả tim:** tim bay trên đầu khách.

Cú pháp, ngưỡng quà và thời gian ghép đổi được trong mục *Luật yêu cầu bài* trên bảng điều khiển.

## Nhạc YouTube

Nhạc phát bằng trình phát nhúng chính thức của YouTube (IFrame API), hiện trên màn hình LED của sân khấu. Không tải video về máy.

- **Nhạc nền:** dán các link YouTube, mỗi dòng một link, bấm *Lưu nhạc nền*. Phát lặp vòng khi không có yêu cầu.
- **Phát ngay / Thêm vào hàng đợi:** dán một link bất kỳ.
- **Hàng đợi yêu cầu:** khách gửi link thì server tự lấy tên bài qua YouTube oEmbed (không cần API key). Khách chỉ gõ tên bài thì yêu cầu hiện **chờ link**: admin dán link vào ô của yêu cầu đó rồi bấm *Lưu link*. Có nút đổi thứ tự, phát ngay, xóa.
- Đang phát nhạc nền mà có yêu cầu sẵn link thì khoảng 9 giây sau (đọc xong thông báo) sẽ chuyển sang bài yêu cầu. Đang phát bài yêu cầu khác thì chờ tới lượt.
- Trong lúc giọng đọc thông báo, nhạc tự hạ nhỏ.
- **Video không phát được:** nhiều MV chính thức (nhất là kênh VEVO, hãng đĩa lớn) chặn phát nhúng ngoài YouTube. Gặp video như vậy, server ghi nhật ký, bỏ qua và phát bài kế. Video nền lỗi bị loại khỏi danh sách. Lỗi liên tục 5 lần trong 30 giây thì dừng nhạc để admin kiểm tra.

## Ảnh

Đặt file vào `assets/` là overlay tự dùng, không cần sửa code:

| File | Kích thước | Ghi chú |
|---|---|---|
| `dj.png` | cao khoảng 800px, nền trong suốt | DJ cắt ngang hông, đứng sau bàn DJ, nhún theo nhịp |
| `bar_bg.jpg` | 1080×1920 | Nền quán bar, không có người |

Chưa có ảnh thì overlay vẽ cảnh tạm bằng canvas (đèn neon, đèn quét, bóng DJ). Vùng cần chừa trống và prompt gợi ý: xem [`assets/README.md`](assets/README.md).

## Bảo mật

Giữ nguyên các lớp bảo mật của bản gốc:

- **Không dùng tài khoản TikTok.** Server chỉ đọc sự kiện công khai của phòng live theo username. Không cần, không hỏi và không lưu mật khẩu, cookie hay session.
- **Chỉ mở trên máy mình.** Server lắng nghe `127.0.0.1`. Muốn mở ra ngoài phải tự đặt biến `HOST`, không nên làm khi chưa thêm đăng nhập.
- **Chặn trang web lạ điều khiển.** WebSocket kiểm tra `Origin` và header `Host` (chống DNS rebinding). Overlay chỉ được gửi đúng một loại tin: báo trình phát hết bài hoặc lỗi, và chỉ được chấp nhận khi khớp bài đang phát.
- **File tĩnh có danh sách trắng.** Chỉ phục vụ `/assets` và `/live`. Chặn file ẩn, `node_modules`, thư mục `test`, mã server, `package.json` và mọi đường dẫn `../`.
- **Không tin dữ liệu vào.** Tên, bình luận, tên quà, tên bài đều bị cắt độ dài. Link YouTube chỉ nhận ID 11 ký tự hợp lệ, server chỉ gọi tới `youtube.com/oembed`. Cài đặt chỉ nhận đúng khóa, đúng kiểu, trong giới hạn. Chữ trên màn hình vẽ bằng `textContent` hoặc canvas, không chèn HTML.
- **Chống spam.** Hàng đợi giọng đọc tối đa 15 câu, hàng đợi nhạc tối đa 30 bài.
- Trang được gửi header `Referrer-Policy: strict-origin-when-cross-origin`, vì trình phát YouTube nhúng cần Referer (thiếu sẽ báo lỗi 153). Ảnh đại diện TikTok vẫn tải với `no-referrer`.

### Lưu ý

- **Bản quyền nhạc:** TikTok tự quét nhạc trong live. Phát nhạc thương mại có thể bị tắt tiếng, cảnh báo hoặc dừng live. Phần này code không xử lý được.
- `tiktok-live-connector` là thư viện cộng đồng, không phải API chính thức của TikTok, có thể ngừng chạy khi TikTok đổi hệ thống.
- Giọng đọc dùng dịch vụ Read Aloud của Microsoft Edge qua mạng (giọng Hoài My, Nam Minh). Máy phát cần có Internet. Server tự thử lại tối đa 3 lần khi bị ngắt giữa chừng.
- TikTok cấm nội dung khiêu dâm và hạn chế nội dung gợi dục. Chọn ảnh DJ và nền phù hợp để tránh bị giảm phân phối hoặc khóa live.

## Miễn trừ trách nhiệm

Dự án được chia sẻ **miễn phí, với mục đích học tập và tham khảo lập trình**. Phần mềm được cung cấp "nguyên trạng" (AS IS), không kèm bất kỳ bảo đảm nào, rõ ràng hay ngụ ý.

Khi tải về, sử dụng, chỉnh sửa hoặc phân phối lại mã nguồn này, **bạn tự chịu hoàn toàn trách nhiệm** về:

- Mọi nội dung bạn phát trên livestream, bao gồm hình ảnh, âm thanh, nhạc, giọng đọc và bình luận được hiển thị.
- Bản quyền của nhạc và video bạn phát qua YouTube.
- Việc nhận quà, donation hoặc bất kỳ khoản thu nào từ người xem.
- Việc tuân thủ điều khoản sử dụng của TikTok, YouTube và các dịch vụ bên thứ ba khác.
- Việc tuân thủ pháp luật nơi bạn sinh sống và hoạt động, kể cả quy định về quảng cáo, thuế và bản quyền.
- Mọi rủi ro và thiệt hại phát sinh, trực tiếp hay gián tiếp, như bị khóa tài khoản, bị dừng live, mất dữ liệu, tranh chấp hay khiếu nại.

Tác giả **không liên quan, không bảo trợ và không chịu trách nhiệm** đối với bất kỳ kênh, tài khoản, sản phẩm hay hoạt động nào sử dụng mã nguồn này.

> **Disclaimer (EN):** This project is shared free of charge for educational purposes only and is provided "AS IS", without warranty of any kind. Anyone who uses, modifies or redistributes it is solely responsible for their own content, streams, music licensing, donations, compliance with TikTok, YouTube and other platforms' terms, and applicable laws. The authors are not affiliated with, do not endorse, and accept no liability for any channel, account, product or activity built with this code, nor for any direct or indirect damages.

## Ủng hộ Kêvin dev

Bar Live chia sẻ miễn phí. Nếu thấy hữu ích và muốn ủng hộ **Kêvin dev** tiếp tục sửa lỗi và làm thêm tính năng, bạn có thể chuyển khoản:

| | |
|---|---|
| Ngân hàng | **VietComBank** |
| Số tài khoản | **0531002524293** |
| Chủ tài khoản | **PHAM DUY TAM VINH** |

![QR chuyển khoản VietComBank](https://img.vietqr.io/image/VCB-0531002524293-compact2.svg?amount=50000&addInfo=ung+ho+bar+online&accountName=PHAM+DUY+TAM+VINH)

Cảm ơn bạn và chúc mỗi buổi live đều cháy hết mình!