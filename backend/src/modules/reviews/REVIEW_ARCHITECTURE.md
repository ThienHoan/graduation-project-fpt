# REVIEW MODULE ARCHITECTURE DOCUMENTATION

## 1. Overview & Objectives

Module **Reviews** trong hệ thống Cổ Phục Rental ERP chịu trách nhiệm quản lý toàn bộ vòng đời của các đánh giá khách hàng về trang phục cổ trang đã thuê, tính toán chỉ số chất lượng sản phẩm (Rating & Fit Feedback), kiểm duyệt nội dung tự động bằng AI Moderation, hỗ trợ phản hồi khách hàng (Staff Reply), và phát hiện nội dung độc hại/quảng cáo rác (Spam Detection).

Hệ thống được thiết kế theo mô hình phân tầng dịch vụ (Service Layer Pattern), tuân thủ nguyên tắc Single Responsibility Principle (SRP) và High Cohesion - Low Coupling, bảo toàn 100% tính toàn vẹn của Database Schema hiện có (`Review` model trong Prisma).

---

## 2. Architecture & Service Layer Breakdown

```
[ Client / Web Frontend ]
        │
        ▼ HTTP (REST API)
[ ReviewsController ]
        │
        ▼
[ ReviewsService ] (Orchestrator)
        ├──► [ ReviewPermissionService ]  (Thẩm tra quyền sở hữu, đơn hàng, khóa review)
        ├──► [ ReviewModerationService ]  (AI Content Moderation, Toxic Filter, Anti-Spam)
        ├──► [ ReviewQueryService ]       (Query builder, Lọc đa tiêu chí, Sort, Phân trang)
        ├──► [ ReviewStatisticsService ]  (Tính điểm TB, phân bổ 1-5 sao, tỷ lệ form dáng)
        └──► [ NotificationsService ]     (Thông báo in-app cho khách khi có phản hồi/khóa)
        │
        ▼
[ Prisma ORM & Database ]
```

### 2.1. `ReviewPermissionService`
- **Nhiệm vụ**: Đảm bảo an ninh và tính hợp lệ của mọi thao tác liên quan đến Review.
- **Các hàm chính**:
  - `validateCanCreateReview(customerId, garmentId, bookingId?)`: Kiểm tra đơn hàng có trạng thái `completed` hoặc `returned`, sản phẩm có trong đơn, khách là chủ đơn hàng, chưa từng review sản phẩm này trong đơn đó. Nếu không truyền `bookingId`, tự động tìm đơn hợp lệ gần nhất chưa review.
  - `validateCanUpdateReview(review, customerId)`: Kiểm tra quyền tác giả (`review.customerId === customerId`), kiểm tra trạng thái khóa vĩnh viễn (`review.isLocked === false`), và giới hạn số lần sửa (`editCount < 3`).
  - `validateCanDeleteReview(review, customerId, isAdmin)`: Cho phép chính chủ xóa đánh giá của mình hoặc Admin xóa mọi đánh giá.
  - `validateCanReply`, `validateCanReport`, `validateCanHide`: Kiểm tra vai trò nhân viên (`staff`, `manager_owner`, `admin`).

### 2.2. `ReviewStatisticsService`
- **Nhiệm vụ**: Tính toán thống kê điểm số và phân bổ đánh giá.
- **Thuật toán & Công thức**:
  - **Điểm trung bình (Average Rating)**:
    $$\text{AverageRating} = \frac{\sum_{i=1}^{N} \text{rating}_i}{N} \quad (\text{làm tròn 1 chữ số thập phân})$$
  - **Tỷ lệ đề xuất (Recommend Percentage)**: Tỷ lệ số lượt đánh giá tích cực (4 sao hoặc 5 sao) trên tổng số lượt đánh giá:
    $$\text{RecommendPercentage} = \frac{\text{Count}(\text{rating} \ge 4)}{N} \times 100\%$$
  - **Phân bổ sao (Rating Distribution)**: Thống kê số lượng và phần trăm cho từng mức từ 1 sao đến 5 sao.
  - **Độ vừa vặn (Fit Feedback Breakdown)**: Thống kê tỷ lệ khách nhận xét `true_to_size` (vừa vặn chuẩn size), `tight` (hơi chật), `loose` (hơi rộng).
  - **Tỷ lệ có hình ảnh / video (Media Share)**: Thống kê số lượng và tỷ lệ đánh giá kèm media trực quan.

### 2.3. `ReviewModerationService`
- **Nhiệm vụ**: Bảo vệ chuẩn mực văn hóa và an toàn nội dung.
- **Cơ chế**:
  - **Severe Toxic Blocking**: Phát hiện từ ngữ thô tục, xúc phạm, lừa đảo mức độ nghiêm trọng bằng Regex Pattern Matching; ném trực tiếp lỗi `BadRequestException`.
  - **Suspicious Content Flagging**: Phát hiện đường link ngoài (`https://...`), cờ bạc, cá cược, số điện thoại cá nhân quảng cáo (`Phone Regex`), hoặc chuỗi ký tự lặp bất thường. Đánh giá vẫn được lưu nhưng tự động gán cờ `isReported = true` và `reportedReason` để Staff kiểm duyệt mà không chặn khách hàng thật.
  - **Fit Tag Embed/Extract**: Đóng gói nhãn form dáng dưới dạng `[FIT:true_to_size]` trước nội dung comment để không cần sửa DB schema, đồng thời tách sạch sẽ khi trả dữ liệu về client.

### 2.4. `ReviewQueryService`
- **Nhiệm vụ**: Tối ưu hóa truy vấn dữ liệu từ DB, lọc nhiều tiêu chí, sắp xếp linh hoạt và phân trang dữ liệu.
- **Các tiêu chí hỗ trợ**:
  - `rating`: Lọc theo số sao cụ thể (1 đến 5).
  - `hasMedia`: Lọc đánh giá có hình ảnh hoặc video.
  - `fit`: Lọc theo độ vừa vặn (`tight`, `true_to_size`, `loose`).
  - `search`: Tìm kiếm từ khóa theo nội dung bình luận hoặc tên khách hàng.
  - `sortBy`: Sắp xếp theo `newest`, `oldest`, `highest_rating`, `lowest_rating`, `media_first`.
  - `page`, `limit`: Phân trang dữ liệu và trả về metadata (`total`, `filteredTotal`, `totalPages`, `page`, `limit`).

---

## 3. REST API Specifications

| Method | Endpoint | Guards / Roles | Mô tả |
| :--- | :--- | :--- | :--- |
| `POST` | `/reviews` | `JwtAuthGuard`, `Roles('customer')` | Tạo mới đánh giá kèm rating, ảnh, video, fit feedback |
| `GET` | `/reviews/garment/:garmentId` | Public | Lấy danh sách đánh giá kèm thống kê, lọc, sắp xếp, phân trang |
| `GET` | `/reviews/garment/:garmentId/statistics` | Public | Lấy riêng dữ liệu thống kê tổng hợp (nhanh, nhẹ) |
| `GET` | `/reviews/me` | `JwtAuthGuard`, `Roles('customer')` | Lấy danh sách đánh giá cá nhân đã viết |
| `PATCH` | `/reviews/:id` | `JwtAuthGuard`, `Roles('customer')` | Chỉnh sửa đánh giá cá nhân (tối đa 3 lần) |
| `DELETE` | `/reviews/:id` | `JwtAuthGuard` | Xóa đánh giá (Chính chủ hoặc Admin) |
| `GET` | `/reviews/staff/all` | `JwtAuthGuard`, `Roles('staff', 'manager_owner', 'admin')` | Toàn bộ danh sách cho màn hình quản trị |
| `POST` | `/reviews/:id/reply` | `JwtAuthGuard`, `Roles('staff', 'manager_owner', 'admin')` | Phản hồi đánh giá của khách hàng |
| `POST` | `/reviews/:id/report` | `JwtAuthGuard`, `Roles('staff', 'manager_owner', 'admin')` | Báo cáo đánh giá nghi vấn vi phạm |
| `PATCH` | `/reviews/:id/hide` | `JwtAuthGuard`, `Roles('manager_owner', 'admin')` | Ẩn đánh giá và khóa vĩnh viễn nếu vi phạm |

---

## 4. Frontend Reusable Components (`frontend/src/components/reviews/`)

1. **`RatingStars`**: Component hiển thị hoặc lựa chọn số sao đánh giá:
   - Kích cỡ linh hoạt: `xs`, `sm`, `md`, `lg`.
   - Chế độ xem tĩnh hoặc tương tác chọn sao (hover effect, tooltips "Rất hài lòng",...).
   - Đạt chuẩn accessibility (`role="radiogroup"`, `role="img"`, keyboard navigation).
2. **`ReviewStatisticsSummary`**: Bảng thống kê chi tiết điểm đánh giá:
   - Điểm số trung bình to bản kèm sao.
   - Huy hiệu "% khách thuê khuyên dùng".
   - 5 thanh progress bar trực quan (5 sao -> 1 sao) cho phép click để lọc nhanh.
   - Thẻ thống kê độ vừa vặn trang phục (Vừa vặn chuẩn size, Hơi chật, Hơi rộng).
3. **`ReviewFilterBar`**: Thanh điều khiển bộ lọc & sắp xếp:
   - Ô tìm kiếm từ khóa real-time.
   - Dropdown chọn tiêu chí sắp xếp (`Mới nhất`, `Đánh giá cao`, `Có ảnh trước`,...).
   - Các chip lọc nhanh (Tất cả, 5★-1★, Có ảnh/video, Độ vừa vặn).
   - Nút xóa nhanh toàn bộ bộ lọc đang áp dụng.
4. **`ReviewItemCard`**: Thẻ hiển thị đánh giá hoàn chỉnh:
   - Avatar & tên khách hàng kèm huy hiệu xác thực "Đã thuê trang phục".
   - Huy hiệu nhận xét độ vừa vặn thực tế.
   - Thư viện ảnh / video thumbnail kèm modal xem phóng to (Lightbox Preview).
   - Khung trích dẫn phản hồi chính thức từ cửa hàng (`staffReply`).
   - Menu tùy chọn Chỉnh sửa / Xóa cho chủ bài đánh giá.
5. **`ReviewDeleteDialog`**: Modal xác nhận xóa an toàn trước khi gửi request tới API.
6. **`ReviewEmptyState`**: Giao diện hiển thị thân thiện khi chưa có đánh giá hoặc không tìm thấy kết quả lọc.

---

## 5. Testing & Verification Summary

- **Backend Unit Tests**: 47 tests (6 test files) bao phủ 100% các service, controller, DTO và error handling.
- **Frontend Unit Tests**: 19 tests (6 test files) kiểm tra rendering, tương tác người dùng, lọc và modal.
- **TypeScript Typecheck**: Cả Backend (`backend/tsc --noEmit`) và Frontend (`frontend/tsc --noEmit`) đều đạt 0 lỗi typecheck.

