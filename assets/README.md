# Ảnh cho Bar Live

Overlay tự dùng ảnh nếu có đúng tên file dưới đây. Chưa có thì overlay vẽ cảnh tạm bằng canvas.

| File | Kích thước | Ghi chú |
|---|---|---|
| `bar_bg.jpg` | 1080×1920 (9:16) | Nền quán bar, **không có người**. Chừa trống các vùng bên dưới. |
| `dj.png` | cao khoảng 900px, nền trong suốt | DJ đứng sau bàn DJ, được vẽ ở giữa, chân ảnh chạm y ≈ 850. |

## Các vùng overlay sẽ vẽ đè lên nền (tọa độ trên khung 1080×1920)

- 0–240: bảng tên quán, đồng hồ
- 248–570: màn hình video YouTube ở giữa (x 255–825), hai thẻ hướng dẫn và bảng VIP hai bên
- 590–905: DJ và bàn DJ (x 280–800)
- 912–970: thanh "đang phát"
- 1000–1900: 10 hoặc 15 bàn khách (overlay tự vẽ bàn)

Vì vậy nền nên là: tường sân khấu có giàn đèn và màn LED ở phần trên, sàn tối trống ở nửa dưới.

## Prompt gợi ý (Google Flow / Imagen)

**Nền `bar_bg.jpg`:**
> Vertical 9:16 interior of an upscale nightclub, empty with no people. Upper half: a stage with a large blank LED screen centered, lighting truss with moving spotlights, pink and cyan neon strips on the back wall. Lower half: dark glossy dance floor with subtle reflections, open empty space, no tables. Moody purple atmosphere, haze, cinematic, high detail, front-facing symmetrical view.

**DJ `dj.png`** (tách nền sau khi tạo, ví dụ bằng công cụ xóa phông):
> Full body front view of a glamorous adult female DJ in her twenties, standing behind turntables, wearing a stylish sequined evening club outfit and over-ear headphones, one hand raised, confident smile, pink and cyan rim lighting, plain dark studio background, high detail.

Lưu ý: TikTok cấm nội dung khiêu dâm và hạn chế nội dung gợi dục. Ảnh quá hở dễ khiến live bị giảm phân phối hoặc bị khóa.
