import { describe, expect, it, vi } from 'vitest';
import { ReviewsController } from './reviews.controller';

describe('ReviewsController', () => {
  const createMockService = () => ({
    create: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
    getGarmentStatistics: vi.fn().mockResolvedValue({ success: true, data: { averageRating: 4.8 } }),
    findAllByGarment: vi.fn().mockResolvedValue({ success: true, data: { reviews: [] } }),
    findAllByCustomer: vi.fn().mockResolvedValue({ success: true, data: [] }),
    update: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
    remove: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
    findAllStaff: vi.fn().mockResolvedValue({ success: true, data: [] }),
    replyToReview: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
    reportReview: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
    hideReview: vi.fn().mockResolvedValue({ success: true, data: { id: 'r1' } }),
  });

  it('delegates create to reviewsService with customerId from request', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    const req = { user: { id: 'customer-123', role: 'customer' } };
    const dto = { garmentId: 'g1', rating: 5, comment: 'Đẹp lắm' };

    await controller.create(req, dto as never);

    expect(service.create).toHaveBeenCalledWith('customer-123', dto);
  });

  it('delegates getGarmentStatistics to reviewsService', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    await controller.getGarmentStatistics('g-99');

    expect(service.getGarmentStatistics).toHaveBeenCalledWith('g-99');
  });

  it('delegates findAllByGarment with query params', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    const query = { rating: 5, hasMedia: true, page: 1, limit: 10 };
    await controller.findAllByGarment('g-1', query as never);

    expect(service.findAllByGarment).toHaveBeenCalledWith('g-1', query);
  });

  it('delegates findAllByCustomer with user ID from request', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    const req = { user: { id: 'customer-123' } };
    await controller.findAllByCustomer(req);

    expect(service.findAllByCustomer).toHaveBeenCalledWith('customer-123');
  });

  it('delegates update with review ID and customer ID', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    const req = { user: { id: 'customer-123' } };
    const updateDto = { rating: 4 };
    await controller.update('r-1', req, updateDto as never);

    expect(service.update).toHaveBeenCalledWith('r-1', 'customer-123', updateDto);
  });

  it('delegates remove with isAdmin flag determined by role', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    // Normal customer
    const customerReq = { user: { id: 'customer-123', role: 'customer' } };
    await controller.remove('r-1', customerReq);
    expect(service.remove).toHaveBeenCalledWith('r-1', 'customer-123', false);

    // Admin user
    const adminReq = { user: { id: 'admin-999', role: 'admin' } };
    await controller.remove('r-1', adminReq);
    expect(service.remove).toHaveBeenCalledWith('r-1', 'admin-999', true);
  });

  it('delegates staff actions: findAllStaff, replyToReview, reportReview, hideReview', async () => {
    const service = createMockService();
    const controller = new ReviewsController(service as never);

    await controller.findAllStaff();
    expect(service.findAllStaff).toHaveBeenCalled();

    const staffReq = { user: { id: 'staff-1' } };
    await controller.replyToReview('r-1', staffReq, { reply: 'Cảm ơn bạn!' });
    expect(service.replyToReview).toHaveBeenCalledWith('r-1', 'staff-1', { reply: 'Cảm ơn bạn!' });

    await controller.reportReview('r-1', staffReq, { reason: 'Quảng cáo' });
    expect(service.reportReview).toHaveBeenCalledWith('r-1', 'staff-1', { reason: 'Quảng cáo' });

    await controller.hideReview('r-1', { reason: 'Vi phạm' });
    expect(service.hideReview).toHaveBeenCalledWith('r-1', 'Vi phạm');
  });
});

