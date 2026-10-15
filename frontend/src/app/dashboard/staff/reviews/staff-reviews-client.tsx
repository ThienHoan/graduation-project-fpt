"use client";

import { useEffect, useState } from "react";
import { getStaffReviews, replyToReview, reportReview, hideReview, StaffReviewResponse } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { Star, AlertTriangle, MessageSquare } from "lucide-react";
import { Pagination } from "@/components/common/pagination";

export function StaffReviewsClient() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<StaffReviewResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [hideReason, setHideReason] = useState("Vi phạm tiêu chuẩn cộng đồng");
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"reply" | "report" | "hide" | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const res = await getStaffReviews();
      if (res.success && res.data) {
        setReviews(res.data);
      } else {
        setError(res.message || "Failed to load reviews");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async (id: string) => {
    if (!replyText.trim()) return;
    try {
      const res = await replyToReview(id, replyText);
      if (res.success) {
        setReplyText("");
        setActionType(null);
        setActiveReviewId(null);
        fetchReviews();
      } else {
        alert("Lỗi khi phản hồi: " + res.message);
      }
    } catch (err: any) {
      alert("Lỗi hệ thống: " + err.message);
    }
  };

  const handleReport = async (id: string) => {
    if (!reportReason.trim()) return;
    try {
      const res = await reportReview(id, reportReason);
      if (res.success) {
        setReportReason("");
        setActionType(null);
        setActiveReviewId(null);
        fetchReviews();
      } else {
        alert("Lỗi khi báo cáo: " + res.message);
      }
    } catch (err: any) {
      alert("Lỗi hệ thống: " + err.message);
    }
  };

  const handleHide = async (id: string) => {
    if (!hideReason.trim()) return;
    try {
      const res = await hideReview(id, hideReason);
      if (res.success) {
        setHideReason("Vi phạm tiêu chuẩn cộng đồng");
        setActionType(null);
        setActiveReviewId(null);
        fetchReviews();
      } else {
        alert("Lỗi khi ẩn: " + res.message);
      }
    } catch (err: any) {
      alert("Lỗi hệ thống: " + err.message);
    }
  };

  if (loading) return <div>Đang tải...</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  const paginatedReviews = reviews.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b">
            <tr>
              <th className="px-4 py-3">Khách hàng</th>
              <th className="px-4 py-3">Sản phẩm</th>
              <th className="px-4 py-3">Đánh giá</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedReviews.map((review) => (
              <tr key={review.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium">{review.customer?.profile?.fullName || review.customerId}</div>
                  <div className="text-xs text-slate-500">{new Date(review.createdAt).toLocaleDateString("vi-VN")}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  {review.garment?.name || review.garmentId}
                </td>
                <td className="px-4 py-3 align-top max-w-xs">
                  <div className="flex items-center gap-0.5 text-amber-500 mb-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i < review.rating ? "text-amber-400 fill-amber-400" : "text-stone-300 fill-transparent"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-stone-700 whitespace-pre-wrap text-sm leading-relaxed">{review.comment || "Không có nội dung"}</p>
                  
                  {review.staffReply && (
                    <div className="mt-2 p-2.5 bg-mist rounded-xl text-xs border border-sand">
                      <span className="font-semibold text-lotus flex items-center gap-1 mb-1">
                        <MessageSquare className="h-3 w-3" />
                        Phản hồi từ xưởng:
                      </span>
                      <p className="text-stone-700">{review.staffReply}</p>
                    </div>
                  )}

                  {review.isReported && review.status === "public" && (
                    <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-xl flex gap-2 items-start">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block mb-1">Nhân viên đã báo cáo:</span>
                        <p className="italic text-red-600">{review.reportedReason}</p>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    review.status === "public" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}>
                    {review.status === "public" ? "Công khai" : "Đã ẩn"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-right space-y-2">
                  <div className="flex flex-col gap-1 items-end">
                    {!review.staffReply && (
                      <button 
                        onClick={() => { setActiveReviewId(review.id); setActionType("reply"); }}
                        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded"
                      >
                        Phản hồi
                      </button>
                    )}
                    
                    {!review.isReported && (
                      <button 
                        onClick={() => { setActiveReviewId(review.id); setActionType("report"); }}
                        className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-1 rounded"
                      >
                        Báo cáo
                      </button>
                    )}

                    {(user?.role === "manager_owner" || user?.role === "admin") && review.status === "public" && (
                      <button 
                        onClick={() => { setActiveReviewId(review.id); setActionType("hide"); }}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1 rounded border border-red-200"
                      >
                        Ẩn đánh giá
                      </button>
                    )}
                  </div>

                  {activeReviewId === review.id && actionType === "reply" && (
                    <div className="mt-2 text-left bg-white border p-3 rounded shadow-sm">
                      <textarea
                        className="w-full text-sm border p-2 rounded mb-2"
                        rows={3}
                        placeholder="Nhập nội dung phản hồi..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setActiveReviewId(null); setReplyText(""); }} className="text-xs px-3 py-1">Hủy</button>
                        <button onClick={() => handleReply(review.id)} className="text-xs bg-black text-white px-3 py-1 rounded">Gửi</button>
                      </div>
                    </div>
                  )}

                  {activeReviewId === review.id && actionType === "report" && (
                    <div className="mt-2 text-left bg-white border p-3 rounded shadow-sm border-amber-200">
                      <textarea
                        className="w-full text-sm border p-2 rounded mb-2 border-amber-200"
                        rows={3}
                        placeholder="Lý do báo cáo vi phạm..."
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setActiveReviewId(null); setReportReason(""); }} className="text-xs px-3 py-1">Hủy</button>
                        <button onClick={() => handleReport(review.id)} className="text-xs bg-amber-600 text-white px-3 py-1 rounded">Báo cáo</button>
                      </div>
                    </div>
                  )}

                  {activeReviewId === review.id && actionType === "hide" && (
                    <div className="mt-2 text-left bg-red-50 border border-red-200 p-3 rounded shadow-sm">
                      <p className="text-xs font-semibold text-red-700 mb-2">Lý do ẩn (Sẽ gửi cho khách hàng):</p>
                      <textarea
                        className="w-full text-sm border p-2 rounded mb-2 border-red-200 bg-white"
                        rows={3}
                        placeholder="Lý do ẩn..."
                        value={hideReason}
                        onChange={(e) => setHideReason(e.target.value)}
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setActiveReviewId(null); setHideReason("Vi phạm tiêu chuẩn cộng đồng"); }} className="text-xs px-3 py-1 text-red-700 hover:bg-red-100 rounded">Hủy</button>
                        <button onClick={() => handleHide(review.id)} className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded">Xác nhận ẩn</button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {reviews.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Không có đánh giá nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <Pagination
          currentPage={page}
          totalItems={reviews.length}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          itemLabel="đánh giá"
        />
      </div>
    </div>
  );
}
