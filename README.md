# FB Group Spam Sentinel - Trợ lý Kiểm duyệt Nhóm Facebook (v1.7.5)

Tiện ích mở rộng (Chrome Extension - Manifest V3) hỗ trợ Quản trị viên và Kiểm duyệt viên phát hiện nhanh các bài viết spam, nick ảo, link lừa đảo, số điện thoại telesale trên các Hội nhóm (Facebook Groups), kèm theo chế độ **Tự động lướt thông minh (Auto-Scroll)**.

---

## 🌟 Tính năng nổi bật

1. **🚀 Tính năng Tự lướt (Auto-Scroll) rảnh tay:**
   - **Thanh điều khiển nổi (Floating Widget):** Xuất hiện ở góc dưới màn hình Facebook.
   - **Nút Bắt đầu / Tạm dừng:** Nhấn nút hoặc bấm phím tắt **`Alt + S`** để bật/tắt lướt bất kỳ lúc nào.
   - **Điều chỉnh tốc độ:** 3 mức tốc độ (`1x` Chậm, `2x` Vừa, `3x` Nhanh).
   - **Tự động dừng khi gặp Spam:** Khi phát hiện bài viết chứa từ khóa/link spam, hệ thống sẽ **ngay lập tức tự dừng cuộn** và đưa bài viết đó vào giữa màn hình để bạn xem xét.
   - **Nút thu nhỏ:** Có thể thu gọn thanh điều khiển thành biểu tượng bong bóng nhỏ gọn khi không dùng.

2. **🛡️ Phát hiện Spam & Nick ảo theo thời gian thực:**
   - Quét nội dung bài viết và bình luận khi lướt.
   - Tự động gắn nhãn cảnh báo đỏ `⚠️ Cảnh báo Nghi vấn Spam / Nick ảo` và viền đỏ quanh bài viết vi phạm.
   - Hiển thị chi tiết lý do vi phạm (từ khóa cụ thể, link telegram/zalo, số điện thoại).

3. **⚙️ Quy tắc nhận diện linh hoạt:**
   - **Từ khóa tùy chỉnh:** Cho phép Quản trị viên thêm/xóa từ khóa rác trong popup tiện ích.
   - **Liên kết độc hại & chuyển hướng:** Nhận diện các link rút gọn (`bit.ly`, `tinyurl...`), kênh `t.me` (Telegram), `zalo.me`, link cờ bạc cá cược.
   - **Số điện thoại:** Tự động phát hiện các định dạng số điện thoại Việt Nam.

4. **👍 Tương tác mọi bài lướt qua:**
   - Tự động Like và (tuỳ chọn) gửi bình luận cho mọi bài viết xuất hiện trong lượt lướt.
   - Không lọc theo từ khóa, link hoặc số điện thoại.
   - Có thể đặt giãn cách, giới hạn số bài mỗi lần chạy và dừng chủ động.
   - Chức năng tương tác đang ở chế độ chủ động: không chạy nếu chưa bấm Bắt đầu.

5. **⚠️ Lưu ý sử dụng:**
   - Tương tác hàng loạt có thể vi phạm chính sách nền tảng hoặc dẫn đến giới hạn tài khoản nếu cấu hình quá mạnh. Hãy sử dụng giới hạn thấp và kiểm tra theo luật/quy định của Facebook.

---

## 🔄 Cách build & cài đặt trên Chrome (Next.js → Manifest V3)

1. Cài đặt thư viện (chỉ cần chạy lần đầu):
   ```bash
   npm install
   ```
2. Kiểm tra kiểu TypeScript & build bản tĩnh ra thư mục `out/`:
   ```bash
   npm run typecheck && npm run build
   ```
3. Mở `chrome://extensions/` trên Chrome:
   - Bật **Chế độ dành cho nhà phát triển** (Developer mode).
   - Chọn **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục **`/Users/duykhanh/extension/out`**.
   - Nếu đã cài rồi, sau mỗi lần chạy `npm run build`, bấm nút **Reload (mũi tên xoay tròn)** trên thẻ **FB Group Spam Sentinel** và tải lại (`Cmd + R`) tab Facebook.
