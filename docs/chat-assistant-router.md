# Chat CSKH assistant router

Tài liệu vận hành ngắn cho router trả lời tự động dùng chung giữa Auto-Reply và
Staff AI Suggestion. Toàn bộ thay đổi đang ở trạng thái **chưa commit, chưa
push, chưa apply migration**.

## 1. Env mới và mặc định

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `BANK_ACCOUNT_AUTO_REPLY` | `false` | `false` = mọi câu hỏi ngân hàng/STK chuyển STAFF với reason `bank_account_manual`. `true` = trả theo cấu hình FAQ `bank_account` (vẫn chuyển STAFF nếu FAQ thiếu giá trị). |
| `CHAT_HANDOFF_TTL_MINUTES` | `30` | Handoff thường tự hết hạn sau số phút này. Hết hạn thì hội thoại không còn bị coi là đang ưu tiên; lần handoff sau mở lại từ đầu. |
| `CHAT_HANDOFF_SENSITIVE_TTL_MINUTES` | `1440` (24 giờ) | Handoff nhạy cảm (khiếu nại, hoàn tiền, thanh toán, đổi/hủy đơn...) giữ hiệu lực lâu hơn để bot không chen tư vấn bán hàng bằng LLM. |
| `CHAT_EVENTS_RETENTION_DAYS` | `90` | Số ngày giữ `chat_assistant_events` trước khi job dọn hàng ngày xoá. |

Các biến được đọc tại thời điểm gọi, không cache lúc module load. Đổi env cần
restart process (hoặc reload cấu hình của môi trường deploy).

## 2. Thứ tự apply migration

Migration: `backend/prisma/migrations/20261028_chat_assistant_router/migration.sql`
(chỉ thêm cột `conversations`, bảng `faq_items`, bảng `chat_assistant_events`).

> **Không chạy `migrate deploy` khi database chưa được baseline.**
> Repo này chưa có baseline migration đầy đủ; `migrate deploy` có thể đánh dấu
> sai trạng thái migration. Chỉ apply đúng file SQL bên dưới bằng
> `prisma db execute`.

1. Backup database và xác nhận `DATABASE_URL` đang trỏ đúng môi trường staging.
2. Apply lần lượt các file SQL còn thiếu theo thứ tự timestamp tăng dần. File
   này phải chạy **sau** tất cả migration hiện có:

   ```bash
   cd backend
   npx prisma db execute --file prisma/migrations/20261028_chat_assistant_router/migration.sql
   ```

   File dùng `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` nên có
   thể chạy lại an toàn nếu lần trước lỗi giữa chừng.
3. `npx prisma generate` để client có model mới.
4. Deploy backend với `BANK_ACCOUNT_AUTO_REPLY=false` (mặc định). Router luôn
   bật nên auto-reply sẽ trả template/FAQ/DB ngay; mọi câu chưa cấu hình FAQ sẽ
   chuyển STAFF thay vì bịa thông tin.
5. Vào `/dashboard/manager/faq` nhập giá trị thật cho từng FAQ và bật
   `isActive` cho mục đã đủ dữ liệu. Riêng `bank_account` cần tick xác nhận.
6. Kiểm tra log/metrics `chat_assistant_events` (`route_type`, `reason`,
   `llm_called`). Chỉ bật `BANK_ACCOUNT_AUTO_REPLY=true` khi đã kiểm tra kỹ
   thông tin ngân hàng.

Lưu ý: `faq_items` seed không chứa giá trị thật — mọi mục mặc định rỗng và
`isActive=false` (trừ `try_on_appointment` được phép giữ trạng thái riêng).
Router gặp mục chưa cấu hình sẽ chuyển STAFF, không render template rỗng.

## 3. Router luôn bật

Từ bản này code legacy (`auto-reply-policy.ts`) và cờ `CHAT_ASSISTANT_ROUTER_ENABLED`
đã bị xoá. Auto-reply và gợi ý cho staff **luôn** đi qua router
`STAFF > FAQ > DB > AI`:

- Cờ không còn tác dụng; nếu còn trong `.env` thì có thể xoá.
- Ngân hàng: giữ `BANK_ACCOUNT_AUTO_REPLY=false` nếu muốn nhân viên tự trả mọi
  câu hỏi STK; chỉ bật `true` khi FAQ `bank_account` đã đúng và đã xác nhận.
- Muốn tạm dừng tính năng: rollback code (mục 4), không còn công tắc env.

## 4. Rollback

1. **Rollback code:** deploy lại commit/tag trước bản cleanup. Vì code cũ bỏ qua
   các cột/bảng mới nên không cần sửa database.
2. **Rollback schema (chỉ khi thật sự cần):**
   - Xác nhận không còn job nào ghi vào các bảng mới.
   - **Backup toàn bộ database trước khi DROP.**
   - **Xuất dữ liệu `faq_items` trước khi DROP** — nếu không sẽ mất toàn bộ
     cấu hình FAQ (địa chỉ, giờ mở cửa, ngân hàng/STK, chính sách...). Ví dụ:

     ```bash
     pg_dump "$DATABASE_URL" --data-only --table=faq_items \
       --file=faq_items_backup.sql
     # hoặc CSV:
     psql "$DATABASE_URL" -c "\copy faq_items TO 'faq_items_backup.csv' WITH (FORMAT csv, HEADER true)"
     ```

   - Sau khi đã có bản export, chạy trong transaction:

```sql
DROP TABLE IF EXISTS "chat_assistant_events";
DROP TABLE IF EXISTS "faq_items";
ALTER TABLE "conversations"
  DROP COLUMN IF EXISTS "handoff_state",
  DROP COLUMN IF EXISTS "handoff_reason",
  DROP COLUMN IF EXISTS "handoff_sensitive",
  DROP COLUMN IF EXISTS "handoff_opened_at",
  DROP COLUMN IF EXISTS "handoff_ack_sent_at",
  DROP COLUMN IF EXISTS "handoff_last_customer_msg_at",
  DROP COLUMN IF EXISTS "handoff_pending_count";
```

   > **Cảnh báo mất dữ liệu:** `DROP TABLE "faq_items"` xoá vĩnh viễn cấu hình
   > FAQ. Chỉ rollback schema khi thật sự cần; nếu chỉ muốn dừng tính năng, dùng
   > rollback code ở bước 1 và giữ nguyên bảng.

## 5. Vận hành

- **Handoff TTL:** handoff thường dùng `CHAT_HANDOFF_TTL_MINUTES` (mặc định 30
  phút); handoff nhạy cảm dùng `CHAT_HANDOFF_SENSITIVE_TTL_MINUTES` (mặc định
  1440 phút). `HandoffService` và `AssistantContextService` dùng chung helper
  `isHandoffExpired`, nên router thật sự bỏ qua handoff đã hết hạn và vẫn chặn
  LLM bán hàng khi handoff nhạy cảm còn hiệu lực.
- **Handoff không chặn câu trả lời tất định:** TEMPLATE/FAQ/DB vẫn trả lời bình
  thường khi handoff đang mở. Chỉ nhánh AI mới bị đếm chống lặp (3 lượt AI liên
  tiếp hoặc cùng intent 2 lần → chuyển STAFF). Vì vậy khách hỏi tiếp địa chỉ,
  hotline, giờ mở cửa... sau khi đã chuyển staff vẫn nhận được câu trả lời.
- **Mọi handoff đều có thông báo cho khách:** kể cả khi handoff đã mở trước đó,
  router vẫn gửi câu thông báo (đơn hàng có câu riêng). Không còn trường hợp
  khách gửi tin mà không nhận được phản hồi. Tin không nhận diện được
  (`UNKNOWN`) cũng chuyển STAFF kèm thông báo thay vì im lặng; chỉ tin rỗng/
  emoji (`SKIP`) là không trả lời.
- **Dọn `chat_assistant_events`:** `AssistantMetricsScheduler` chạy mỗi ngày lúc
  `03:30` giờ `Asia/Ho_Chi_Minh`, gọi `AssistantMetricsService.cleanupExpired()`
  và xoá bản ghi cũ hơn `CHAT_EVENTS_RETENTION_DAYS`. Nhiều instance cùng chạy
  vẫn an toàn vì thao tác idempotent.
- **Template greeting/thanks:** hardcode trong
  `backend/src/modules/chat/assistant/assistant-router.service.ts`
  (`TEMPLATE_REPLIES`), không lấy từ FAQ:
  - greeting: `Dạ em chào anh/chị ạ. Anh/chị cần em hỗ trợ gì không ạ?`
  - thanks: `Dạ em cảm ơn anh/chị ạ.`
  - hỏi lại khi thiếu slot: `Dạ anh/chị cho em biết rõ hơn mẫu, size hoặc màu mong muốn để em hỗ trợ đúng ạ.`
  - xác nhận handoff: `Dạ em đã ghi nhận và chuyển cho nhân viên hỗ trợ anh/chị ngay ạ.`
    (câu riêng cho đơn hàng: `Dạ em đã ghi nhận đơn của anh/chị và chuyển nhân viên kiểm tra, xử lý ngay ạ.`).
- **Chat bubble chỉ hiện khi đã đăng nhập:** `CustomerChatProvider` chỉ render
  bubble khi `AuthProvider` báo `status = "authenticated"`, có `accessToken` và
  role `customer`. Trong lúc còn kiểm tra session cũ (`loading`) hoặc khách chưa
  đăng nhập, bubble/hello được ẩn hoàn toàn; không gọi API chat hay mở socket.
- **Phân quyền FAQ:** endpoint `GET/PUT /chat/faq` dùng `JwtAuthGuard` +
  `RolesGuard`, `@Roles("manager_owner", "admin")`. Customer/staff bị từ chối;
  khách chưa đăng nhập bị `401`.
- **Log FAQ:** log ứng dụng chỉ ghi key, tên field lỗi và cache key; không ghi
  giá trị `values` (kể cả khi validate lỗi). Có test chặn hồi quy cho
  `bank_account`.
- **Audit sửa FAQ:** `audit_logs.metadata` lưu `key`, `changedFields`,
  `changedBy`, `changedAt`; riêng `bank_account` thêm
  `masked.account_number` (chỉ 4 ký tự cuối). Không bao giờ lưu full STK.

## 6. Hỏi tiếp sau product card và duyệt danh mục

Các câu hỏi tiếp theo product card được xử lý tất định bằng DB, không gọi LLM
và không trả FAQ chung:

| Câu hỏi | Intent | Cách trả lời |
| --- | --- | --- |
| Khách gửi product card | `db.product_card_detail` | Trả ngay thông tin mẫu (tên, màu, size, giá/ngày) + product card + hỏi khách cần tư vấn thêm gì. |
| "Tư vấn tôi sản phẩm X" / "Cho tôi thông tin về sản phẩm X" | `db.product_info` | Trả tên, màu, giá, danh sách size đang mở thuê, phụ kiện đi kèm **kèm số lượng** và giá thuê thêm. Mẫu không gắn phụ kiện → nói rõ "chưa gắn phụ kiện". Phụ kiện gắn theo mẫu, chưa tách theo size → nhắc khách cần đúng size thì nhờ nhân viên xác nhận. |
| Còn hàng ngày mai / 20/11 / thứ 7... | `db.product_availability` | Đếm `garment_assets` đang `available`/`cleaned` trừ các booking còn hiệu lực trùng ngày. Không có ngày → hỏi lại ngày; không có asset → chuyển STAFF `availability_unverified`. |
| Có phụ kiện đi kèm không | `db.product_accessories` | Đọc `garment_accessories` của đúng mẫu đang xem, kèm giá thuê thêm hoặc "kèm theo". |
| Còn mẫu khác không | `db.product_alternatives` | Lấy tối đa 2 mẫu active cùng `categoryId` (trừ mẫu hiện tại) + product card. |
| Shop có bán gì / có những sản phẩm gì | `db.product_categories` | Liệt kê `garment_categories` đang active và có ít nhất một mẫu active. |
| Hỏi theo màu/size cụ thể (vd "shop có sản phẩm màu hồng không") | `db.catalog_search` | Tra toàn bộ catalog active theo màu/size, không dùng lại product card gần nhất. Ra nhiều mẫu → liệt kê tối đa 3 mẫu + product card; không có → trả lời thật là chưa có mẫu phù hợp. |
| Hỏi kèm dịp (dự tiệc, cưới, công sở...) | `db.catalog_search` | Lọc thêm `garment.occasion`; nếu dữ liệu dịp trống hoặc không khớp thì bỏ lọc dịp và giữ màu/size để không trả lời sai. |
| Khách chọn danh mục (vd "áo dài") | `db.category_products` | Khớp tên danh mục thật, trả 2 mẫu active + product card. |
| Khách trả lời "có" sau câu mời của shop | `db.product_categories` / `db.product_alternatives` | Đọc câu mời ngay trước: mời xem danh mục → liệt kê danh mục; chỉ mời mẫu khác → gợi ý mẫu khác. Không rõ ý → hỏi lại ngắn, không chuyển STAFF. |

- Product card được tạo từ `productIds` của handler (tối đa 3), gồm tên, ảnh,
  size và giá ngày; nội dung text liệt kê thông tin từng mẫu.
- Nhận diện khách chọn danh mục dựa trên tin nhắn trước của shop có chứa
  "danh mục" và "muốn xem loại nào".
- Câu trả lời ngắn "có"/"đúng rồi"/"phải rồi" chỉ được hiểu là đồng ý khi tin
  trước của shop là câu hỏi và có mời xem danh mục hoặc mẫu khác; ngoài các
  trường hợp đó vẫn xử lý như tin nhắn bình thường.
- Màu được lấy từ token màu gần cuối câu và bỏ qua từ đồng âm: "trang" trong
  "trang phục", "đồ" trong "đồ này/đồ gì/đồ đẹp". Vì vậy "có trang phục xám k"
  tra màu `xam`, không phải `trang`.
- "Tư vấn" chỉ rơi vào nhánh thông tin sản phẩm (`db.product_info`) khi câu có
  tín hiệu rõ ("thông tin", "sản phẩm", "thông số") **và** nêu tên mẫu. "Tư vấn
  cho mình bộ đi tiệc" hay "tư vấn giúp mình áo dài size M" vẫn là tư vấn phong
  cách ở nhánh AI.
- Từ chỉ nhóm chung ("trang phục", "bộ đồ") không bị coi là tên mẫu. "Có trang
  phục màu đen không" tra mọi mẫu active màu đen, không đòi tên mẫu chứa chữ
  "trang phục"; còn "có áo dài đen không" vẫn đòi đúng tên có "áo dài".
- Câu hỏi gộp nhiều chủ đề FAQ (vd "thuê bao lâu và giá ship như nào") trả về
  `faqKeys`; router render **tất cả** key và nối bằng xuống dòng. Nếu bất kỳ key
  nào thiếu cấu hình, router chuyển STAFF `faq_config_missing` thay vì trả một
  nửa câu trả lời.

## 7. Lọc theo khoảng giá thuê

| Câu hỏi | Intent | Cách trả lời |
| --- | --- | --- |
| "cho tôi các sản phẩm màu đỏ giá thuê dưới 100k" | `db.catalog_price` | Lọc `garment_sizes.daily_price <= priceMax`, thêm điều kiện màu nếu có. Liệt kê tối đa 3 mẫu rẻ nhất + product card. |
| "Cho tôi các áo dài duói 700k" | `db.catalog_price` | Số trần kèm `k` hiểu là 700.000đ. |
| "cho tôi các trang phục giá thuê trên 500k" | `db.catalog_price` | `priceMin = 500.000`. |
| "Cho tôi các sản phẩm từ 300 đến 1 triệu" | `db.catalog_price` | `priceMin = 300.000`, `priceMax = 1.000.000`. |
| "Cho tôi các trang phục giá từ 500k đến 10 triệu" | `db.catalog_price` | `priceMin = 500.000`, `priceMax = 10.000.000`. |

- Slot `priceMin`/`priceMax` được tách trong `extractPriceRange()`
  (`message-classifier.ts`). Đơn vị hiểu được: `k`, `nghìn`, `ngăn`, `tr`,
  `triệu`, `m`; số trần (`300`) chỉ thành mốc giá khi từ ngay sau là
  `đến`/`dưới`/`trên`/`trở`/`tới`/`không`/`quá`/`hơn` — nhờ vậy "thuê 3 bộ
  vest" vẫn là số lượng, không phải 3.000đ.
- "đến" trong khoảng giá bị loại khỏi danh sách từ màu để không bị hiểu thành
  màu "đen".
- Nhánh này đứng **trước** `db.product_price` trong `detectDb()` và chỉ áp dụng
  khi câu không trỏ vào mẫu đang xem (`productReference !== "last_card"`), nên
  "áo dài đỏ giá bao nhiêu" hay "mẫu này giá dưới 100k" vẫn là hỏi giá một mẫu.
- Không có mẫu nào trong khoảng → trả lời thật là "chưa có mẫu", không bịa và
  không chuyển STAFF.

## 7b. Lọc / liệt kê theo dịp

| Câu hỏi | Intent | Cách trả lời |
| --- | --- | --- |
| "mẫu trang phục đi tết" | `db.catalog_occasion` | Lọc `garment.occasion` chứa Tết, tối đa 3 mẫu rẻ nhất + product card. |
| "đồ dự tiệc" / "đi đám cưới" | `db.catalog_occasion` | Dùng chung keyword trong `occasions.ts`. |
| "áo dài đi tết" | `db.catalog_occasion` | Lọc thêm theo tên mẫu (`áo dài`). |
| "mẫu đi tết dưới 500k" | `db.catalog_price` | Khoảng giá đứng trước; sau đó lọc thêm dịp nếu có mẫu khớp. |

- `occasions.ts` là nguồn duy nhất cho keyword dịp (đã bỏ dấu) và nhãn tiếng
  Việt, dùng chung cho bộ phân loại và `DbHandlersService`.
- Lọc dịp dùng `matchesOccasionStrict`: mẫu **chưa nhập** `occasion` không được
  coi là khớp. Nếu không mẫu nào khớp, câu trả lời nói rõ "chưa phân loại mẫu
  theo dịp X" và liệt kê vài mẫu đang mở thuê thay vì bịa.
- Câu có tín hiệu xin lời khuyên/​cách mặc ("tư vấn", "gợi ý", "nên mặc", "mặc
  gì", "phối", "hợp với", "so sánh", "đẹp không") **không** đi nhánh này — để AI
  tư vấn.

## 8. Gợi ý AI theo tin khách mà staff chọn trả lời

- Trước đây gợi ý luôn dựa trên **tin khách mới nhất**. Giờ nếu staff bấm "Trả
  lời" một tin của khách rồi bấm "Gợi ý", frontend gửi kèm `messageId` của tin
  đó: `POST /chat/conversations/:id/suggestion` body `{ "messageId": "..." }`.
- Backend (`ChatService.suggestReplyForStaff`) chỉ nhận tin **của khách**, chưa
  xoá, `message_type = text` và có nội dung. Tin không hợp lệ (tin staff, tin đã
  xoá) → quay lại hành vi cũ: tin khách mới nhất.
- Ngữ cảnh:
  - `AssistantContextService.build()` nhận `currentMessageId`, tra
    `created_at` của tin đó và chỉ lấy các tin **trước** mốc này — không trộn
    tin phát sinh sau đó vào phân loại.
  - Nhánh AI gửi kèm tối đa **6 tin** ngay trước tin được chọn
    (`buildAutoReplyHistory(..., { before, limit: 6 })`).
- Cache vẫn theo `messageId` (`chat:suggestion:v2:<messageId>`), nên bấm gợi ý
  nhiều lần cho cùng một tin không tốn thêm lượt model.
- UI hiện nhãn "Dựa trên tin nhắn khách đang được trả lời" + trích nội dung tin
  đó; khi không chọn tin nào thì là "Dựa trên tin nhắn mới nhất của khách".

## 9. Câu nào thực sự gọi AI

Router luôn chạy `STAFF > FAQ > DB > AI`; **chỉ nhánh AI mới gọi model**
(Gemini cho text; ảnh vẫn qua OpenRouter vision).

| Nhóm | Ví dụ | Xử lý |
| --- | --- | --- |
| STAFF | khiếu nại, mất/đổi/huỷ đơn, cọc – thanh toán – STK, đơn sỉ ≥ 5 bộ, xin gặp nhân viên, gửi ảnh/video | Chuyển nhân viên + câu thông báo. Không gọi AI. |
| FAQ | địa chỉ, giờ mở cửa, chính sách thuê/cọc/trả, ship, đổi trả, bảng size, phụ kiện, đặt lịch thử đồ | Render từ `faq_items`. Không gọi AI. |
| DB | giá, size, còn hàng theo ngày, phụ kiện của mẫu, mẫu khác, danh mục, lọc màu/size/**khoảng giá**, **lọc theo dịp** ("mẫu trang phục đi tết", "đồ dự tiệc") | Truy vấn DB thật. Không gọi AI. |
| TEMPLATE / SKIP | "chào shop", "cảm ơn", "ok", "ko/thôi", emoji | Câu cố định hoặc không trả lời. Không gọi AI. |
| AI | so sánh mẫu ("so sánh giúp mình", "mẫu nào đẹp hơn"), chọn size theo số đo ("cao 1m65 nặng 55kg mặc gì"), kiến thức áo dài/cổ phục ("nguồn gốc", "ý nghĩa", "chất liệu"), tư vấn phối đồ ("mặc gì đi tiệc", "phối với giày nào", "tư vấn giúp mình đồ đi tiệc") | Gọi Gemini với lịch sử chat + product card gần nhất; trả tối đa 3 chủ đề × 3 sản phẩm. |

- Ranh giới DB ↔ AI khi có chữ chỉ dịp: câu **chỉ nêu dịp** ("mẫu trang phục
  đi tết", "đi tiệc") → `db.catalog_occasion`; câu **xin lời khuyên / hỏi cách
  mặc** ("tư vấn", "gợi ý", "nên mặc", "mặc gì", "phối", "hợp với", "so sánh",
  "đẹp không") → nhánh AI.
- Handoff nhạy cảm (khiếu nại, hoàn tiền, thanh toán, đổi đơn) **không còn chặn
  toàn bộ AI**: chỉ các intent an toàn `ai.styling`, `ai.sizing`, `ai.heritage`,
  `ai.comparison` được trả lời; câu hỏi tiền/cam kết vẫn rơi vào STAFF hoặc DB.
  Trước đây chặn cả TTL 24 giờ khiến khách hỏi "mặc gì đi tiệc" không nhận được
  gợi ý nào.

- Auto-reply: tin khách đến → router phân loại → nhánh AI thì gọi
  `aiService.productAdvisor(...)` với tối đa 15 tin gần nhất, rồi lưu câu trả
  lời. Lỗi model/timeout/429/rỗng → lưu câu dự phòng
  (`Em đã ghi nhận câu hỏi của bạn. Nhân viên sẽ phản hồi bạn trong ít phút ạ.`),
  tối đa một lần mỗi 5 phút, không im lặng.
- Gợi ý cho staff: chỉ chạy khi staff bấm nút, dùng **cùng** router (nên DB/FAQ
  vẫn trả tất định), nhưng không tự gửi tin. Nhánh AI lỗi → không có chủ đề gợi
  ý, UI hiện thông báo thân thiện để staff thử lại.
- Hạn mức: Gemini free tier ~20 request/ngày/model. Hết hạn mức thì nhánh AI
  dùng câu dự phòng ở trên; các nhánh FAQ/DB/TEMPLATE vẫn chạy bình thường vì
  không gọi model.

