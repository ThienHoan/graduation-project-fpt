# Context

Rà soát booking phát hiện lỗi thanh toán/cancel chạy đồng thời, callback mở lại đơn hủy, thiếu hoàn tiền cho đơn đã thu tiền, overlap ngày không thống nhất, asset bị thay đổi ngoài booking và handover REJECTED không có đường phục hồi. Người dùng yêu cầu sửa các lỗi đã xác minh.

Quy tắc người dùng đã chọn:
- Hủy trước bàn giao: tạo yêu cầu hoàn **toàn bộ tiền thực thu**, gồm thuê, cọc và phí giao; manager xác nhận chi trả thực tế. Không tự chuyển tiền.
- Từ chối bàn giao: manager được **đổi asset rồi giao lại hoặc hủy/hoàn tiền**, giữ lịch sử biên bản cũ.

Giới hạn: không migration, không db push, không sửa dữ liệu production, không commit/push. Không gọi PayOS thật để tạo/thu/hoàn tiền trong kiểm thử. Không phát PII, URL bằng chứng hoặc thông tin ngân hàng qua realtime. Không tự thêm unique constraint khi chưa kiểm tra Supabase và được duyệt riêng.

# Cách triển khai

Chia thành các nhóm dưới đây để kiểm thử từng nhóm, nhưng phạm vi gồm toàn bộ lỗi đã xác minh. Tái sử dụng `PrismaService.runSerializable` (`backend/src/prisma/prisma.service.ts`), CAS/updateMany, BookingStatusHistory, Refund, FinancialTransaction và DeliveryRecord hiện có. Không coi mock transaction là bằng chứng kiểm thử concurrency PostgreSQL.

## 1. Thanh toán, hủy đơn và hoàn tiền nguyên tử

Files chính: `backend/src/modules/payments/payments.service.ts`, `payments.controller.ts`, `payments.module.ts`; `backend/src/modules/bookings/bookings.service.ts`; `backend/src/modules/refunds/refunds.service.ts`; helper transaction-aware dùng chung cho settlement/refund và module đăng ký tương ứng.

- Đưa kiểm tra trạng thái/payments của `markPaid` vào cùng Serializable transaction. Claim booking trước các ghi phụ; retry hợp lệ không tạo thêm payment/history.
- Timeout đọc lại cả deadline, trạng thái và payments trong transaction. Claim thất bại phải rollback mọi thay đổi, không commit release asset/history rồi return false. Chỉ nhả asset vật lý thật sự đang do đơn này giữ.
- Customer cancel, staff reject/cancel và manager hủy sau handover bị từ chối dùng chung xử lý hủy: CAS trạng thái, giải phóng assignment/physical hold đúng chủ sở hữu, tạo yêu cầu hoàn các khoản đã thu chưa được hoàn. Đơn giữ trạng thái cancelled/rejected; refund theo dõi riêng, không biến đơn hủy thành completed.
- Phân biệt hoàn cọc sau kiểm tra với hoàn toàn bộ do hủy/thu trùng bằng metadata nội bộ bất biến trên các field hiện có. Dùng marker FinancialTransaction liên kết refund, amount=0 và transactionType riêng; không đưa marker vào tổng thu/chi. Không dùng nội dung reason do client cung cấp để quyết định quyền hoặc số tiền hoàn.
- Approval hoàn do hủy căn cứ tiền thực thu và số đã hoàn/yêu cầu đang mở theo payment; không áp dụng công thức deposit-minus-penalty của hoàn cọc. Dùng Decimal khi cộng/trừ tiền. Một khoản thu không được hoàn hai lần.
- Yêu cầu hoàn có thể chờ bổ sung tài khoản ngân hàng; manager chỉ xác nhận đã hoàn khi có đủ thông tin/bằng chứng theo phương thức hiện hành. Cập nhật API/UI danh sách hoàn để bao gồm đơn cancelled/rejected, hiển thị đúng mục đích và tổng tiền.

### PayOS và idempotency

- `createPaymentLink`: kiểm tra ownership, trạng thái được thanh toán và số tiền còn phải thu; tạo/tái sử dụng payment intent trong DB **trước** gọi PayOS. Không hủy pending rồi tạo link mới cho mỗi retry.
- Serialize việc tạo intent theo booking bằng khóa DB transaction-scoped, không khóa in-memory. Cấp orderCode ổn định, chống trùng giữa booking/process bằng allocator có khóa DB và kiểm tra dữ liệu hiện có, không cần sửa schema.
- Gọi PayOS ngoài callback Serializable có thể retry. Khi timeout không rõ provider đã tạo hay chưa, tra cứu lại cùng orderCode; không tạo mã mới mù quáng. Nếu PayOS đã đóng order, xác nhận trạng thái trước khi cho tạo attempt mới.
- Webhook/reconcile dùng chung settlement: xác minh chữ ký/kết quả provider, đối chiếu mã, số tiền và tiền tệ theo dữ liệu SDK; từ chối match mơ hồ thay vì findFirst tùy ý. CAS payment để chỉ một xử lý tạo history/refund.
- Payment đến trễ sau hủy vẫn ghi nhận tiền thật nhưng **không mở lại booking**; tạo yêu cầu hoàn tương ứng. Khoản thanh toán thứ hai không bị bỏ qua hoặc gộp vào khoản thứ nhất: ghi nhận và đưa vào hoàn tiền thu dư.
- Không lùi booking đang paid/preparing/renting về pending_confirmation. Provider cancellation không được ghi đè payment đã paid.
- `GET /payments/:bookingId/status`: kiểm tra chủ đơn hoặc role vận hành trước đọc/reconcile. DTO kiểm tra UUID. Bỏ log toàn bộ webhook có dữ liệu nhạy cảm.
- Notification/realtime sau commit; không phát lại tác dụng phụ khi retry/no-op. Lỗi notification không làm client hiểu nhầm rằng giao dịch DB chưa thành công.

## 2. Thống nhất tồn kho, ngày thuê và assignment

Files: `bookings.service.ts`, `dto/create-booking.dto.ts`, các API available-assets trong garments/assets và callers ở manager.

- Ngày thuê inclusive, tính cả ngày đầu/cuối. Shared helper áp dụng cùng quy tắc cho check, create, calendar và assignment.
- Tính nhu cầu đồng thời lớn nhất bằng sweep-line theo ngày, không cộng mọi booking giao toàn khoảng. Kiểm tra requestedQtyBySize; tránh đếm trùng asset đang bị giữ quá hạn.
- Asset quá hạn chưa trả không được hứa là sẵn hàng dựa trên ngày trả dự kiến đã qua. Chặn khả dụng của asset đó cho tới khi trả/kiểm tra, kể cả booking vẫn renting nhưng ngày đã hết.
- Calendar dùng cùng capacity/occupancy với create. Chỉ nhận garment/size còn hoạt động; kiểm tra trong transaction tạo booking để tránh dữ liệu stale. So sánh số size với tập ID phân biệt, vẫn tạo đúng số item lặp.
- Chặn ngày tạo booking trong quá khứ theo ngày Việt Nam; không áp dụng ràng buộc này cho đọc lịch sử. Whitelist pickupMethod store_pickup/delivery.
- Tách assignment theo lịch (BookingItem.garmentAssetId) khỏi physical hold: gán lịch tương lai không tự khóa asset vật lý; claim reserved khi bắt đầu preparing. Gán chung asset cho khoảng không giao nhau được phép, nhưng cùng đơn không được gán trùng asset.
- Mọi prepare/handover/cancel/return kiểm tra chủ sở hữu physical hold thông qua booking liên quan, không nhả asset chỉ vì status=reserved. Không cho đơn tương lai chiếm asset đang được đơn khác chuẩn bị/thuê. Existing reserved assignments được nhận diện qua quan hệ hiện có và xử lý bảo thủ; không tự sửa hàng loạt dữ liệu cũ.
- Cho manager unassign/reassign có kiểm tra khi chưa bàn giao, lưu actor/lý do/history; không thay assignment của đơn đang renting.
- `assets.service.ts`: CAS + transaction cho thay trạng thái; chặn đổi trực tiếp các trạng thái thuộc vòng đời booking hoặc làm mất khả năng phục vụ assignment đang hoạt động. Các thao tác vận hành có booking phải đi qua service tương ứng.

## 3. Bàn giao đầy đủ và phục hồi REJECTED

Files: `confirm-handover.dto.ts`, `bookings.controller.ts`, `bookings.service.ts`, `frontend/src/components/bookings/handover-confirmation-modal.tsx`, staff list/detail, manager assignment UI, `frontend/src/lib/api.ts`.

- Backend bắt buộc ảnh HTTP(S), người giao/người nhận không rỗng, checklist; MINOR_DAMAGE phải có mô tả. Giới hạn số ảnh/độ dài input. Không tin frontend validation.
- REJECTED không tự cho thuê hoặc xóa bằng chứng. Thêm action recovery chỉ manager/admin, với expected trạng thái/phiên biên bản để chặn request stale.
- Đổi đồ: giữ snapshot biên bản cũ trong JSONB conditionImages có version/history (hỗ trợ đọc legacy array/object), kiểm tra replacement đúng mẫu/size và lịch, cách ly asset có lỗi trước khi dùng lại; reset biên bản hiện tại về pending và booking về bước chuẩn bị thích hợp trong một transaction.
- Hủy: ghi lịch sử, xử lý asset lỗi an toàn và gọi settlement hoàn toàn bộ; không biến đồ lỗi thành available vô điều kiện.
- Confirm terminal retry chỉ idempotent nếu payload tương đương biên bản đã lưu; payload khác trả conflict. Không cho API PENDING xóa bằng chứng terminal.
- UI ẩn nút confirm trên biên bản REJECTED cho tới khi recovery hoàn thành; thêm summary và realtime cho staff detail. Hiển thị receivedAt cho nhận hàng, decidedAt với nhãn quyết định/từ chối.

## 4. Snapshot giao hàng, API và UI còn lại

- Tạo immutable snapshot đầy đủ (địa chỉ, người nhận, tọa độ, dữ liệu phục vụ giao hàng) vào `DeliveryRecord.addressSnapshot` dưới dạng versioned JSON cùng transaction tạo booking. Dùng snapshot cho serializer/map/tracking/handover, không dùng address book đang sửa. Bảo vệ record snapshot khỏi API cập nhật thông thường. Legacy không có snapshot phải hiển thị rõ giới hạn; không tự backfill dữ liệu production hoặc giả vờ snapshot mới là địa chỉ lịch sử.
- Tracking chỉ báo đã nhận khi handover confirmed; chưa có GPS thật không hiển thị vị trí mô phỏng như vị trí thật. Nếu giữ demo phải gắn nhãn rõ; ưu tiên trạng thái giao hàng thực và các mốc DeliveryRecord.
- Đặt staff/assets-needed trước staff/:id và thêm route regression test.
- Pagination/filter/search server-side cho các queue staff; cập nhật callers trong staff/manager và API types đồng bộ, manager lấy queue cần asset riêng thay vì suy ra từ 100 đơn mới nhất.
- Date-selection dùng request generation/cancellation để bỏ response cũ. Sửa label handover bị từ chối và lỗi gửi form để luôn kết thúc loading.

## 5. Bảo vệ upload ảnh

Files: `frontend/src/app/api/upload/route.ts`, upload callers và helper xác thực server phù hợp.

- Xác thực Bearer token qua backend auth hiện có, không chỉ decode JWT; role theo mục đích upload. Không đưa service-role key xuống client.
- Bucket whitelist theo mục đích, giới hạn kích thước và MIME, đường dẫn do server tạo. Không cho client chọn bucket tùy ý.
- DELETE kiểm tra origin/bucket/path và quyền với object; ưu tiên không cho xóa ảnh đã được dùng làm bằng chứng. Object legacy không xác định quyền phải fail closed. Cập nhật các caller hiện có gửi token để không làm hỏng upload hợp lệ.

# Verification

1. Regression unit/controller/component tests cho từng nhóm trước và sau sửa. Đóng băng thời gian trong test, không phụ thuộc ngày chạy.
2. Payments: hai create-link cùng booking; provider timeout rồi retry cùng orderCode; webhook+reconcile đồng thời; callback trùng; sai tiền/chữ ký/mã mơ hồ; hủy trước/sau payment; thu dư; hai markPaid; timeout đấu markPaid; ownership 403; không tạo refund hoặc ledger hai lần.
3. Inventory: thuê cùng ngày, chạm ngày cuối, booking nối tiếp không bị cộng sai, số lượng lặp, hết kho, overdue, calendar parity; assignment tương lai không chặn booking đến trước; chuẩn bị cạnh tranh chỉ một chủ asset thắng.
4. Handover: đủ/thiếu bằng chứng; rejected→replace→confirm; rejected→cancel/refund; asset lỗi không available; history nguyên vẹn; request stale bị conflict; customer không được recovery.
5. UI/API: queue có hơn 100 đơn vẫn tìm được đơn cũ; snapshot không đổi khi sửa address book; tracking không nhận giả; response availability đảo thứ tự; upload thiếu token/sai role/bucket/path bị chặn.
6. Chạy backend typecheck/test/lint; frontend typecheck/test/lint/build bằng npm --prefix đường dẫn tuyệt đối để tránh sai cwd. `git diff --check` và review cuối các luồng tiền/trạng thái.
7. Integration concurrency với PostgreSQL chỉ dùng DB test tách biệt được xác nhận; không dùng DATABASE_URL production hoặc chạy setup schema tùy tiện. Nếu chưa có DB test an toàn, thêm suite opt-in và ghi rõ chưa chạy integration thực, không tuyên bố hết race chỉ dựa trên mock.
8. Báo cáo file đã đổi, test pass/fail/skipped, giới hạn còn lại. Không tự sửa dữ liệu lịch sử đã bị lỗi; nếu cần repair sau này phải đưa SQL cụ thể và xin duyệt riêng.

