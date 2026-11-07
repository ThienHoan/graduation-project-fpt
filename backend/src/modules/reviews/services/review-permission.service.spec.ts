import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPermissionService } from './review-permission.service';

describe('ReviewPermissionService', () => {
  const createMockPrisma = () => ({
    booking: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
    },
  });

  describe('validateCanCreateReview', () => {
    it('resolves first unreviewed booking when bookingId is not specified', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findMany.mockResolvedValue([
        {
          id: 'booking-completed-1',
          customerId: 'c1',
          status: 'completed',
          reviews: [{ garmentId: 'other-garment' }],
        },
      ]);
      prisma.booking.findUnique.mockResolvedValue({
        id: 'booking-completed-1',
        customerId: 'c1',
        status: 'completed',
        items: [{ garmentId: 'g1' }],
      });
      prisma.review.findUnique.mockResolvedValue(null);

      const service = new ReviewPermissionService(prisma as never);
      const bookingId = await service.validateCanCreateReview('c1', 'g1');

      expect(bookingId).toBe('booking-completed-1');
    });

    it('throws BadRequestException when no eligible booking is found', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findMany.mockResolvedValue([]);

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when specified booking does not exist', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findUnique.mockResolvedValue(null);

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1', 'nonexistent-b')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when booking belongs to another customer', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        customerId: 'c2',
        status: 'completed',
        items: [{ garmentId: 'g1' }],
      });

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1', 'b1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when garment is not in the booking items', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        customerId: 'c1',
        status: 'completed',
        items: [{ garmentId: 'g-other' }],
      });

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1', 'b1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when booking status is not completed or returned', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        customerId: 'c1',
        status: 'confirmed',
        items: [{ garmentId: 'g1' }],
      });

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1', 'b1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when review already exists for this combo', async () => {
      const prisma = createMockPrisma();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        customerId: 'c1',
        status: 'completed',
        items: [{ garmentId: 'g1' }],
      });
      prisma.review.findUnique.mockResolvedValue({ id: 'existing-r' });

      const service = new ReviewPermissionService(prisma as never);
      await expect(service.validateCanCreateReview('c1', 'g1', 'b1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateCanUpdateReview', () => {
    it('throws ForbiddenException if customer is not the author', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanUpdateReview({ id: 'r1', customerId: 'author-id' }, 'other-user'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if review is locked', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanUpdateReview(
          { id: 'r1', customerId: 'c1', isLocked: true },
          'c1',
        ),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if editCount has reached 3', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanUpdateReview(
          { id: 'r1', customerId: 'c1', editCount: 3 },
          'c1',
        ),
      ).toThrow(ForbiddenException);
    });

    it('passes for valid owner within edit limits', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanUpdateReview(
          { id: 'r1', customerId: 'c1', editCount: 1, isLocked: false },
          'c1',
        ),
      ).not.toThrow();
    });
  });

  describe('validateCanDeleteReview', () => {
    it('throws ForbiddenException if not owner and not admin', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanDeleteReview({ id: 'r1', customerId: 'c1' }, 'c2', false),
      ).toThrow(ForbiddenException);
    });

    it('allows owner to delete', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanDeleteReview({ id: 'r1', customerId: 'c1' }, 'c1', false),
      ).not.toThrow();
    });

    it('allows admin to delete review of any user', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() =>
        service.validateCanDeleteReview({ id: 'r1', customerId: 'c1' }, 'admin-id', true),
      ).not.toThrow();
    });
  });

  describe('Role actions: reply, report, hide', () => {
    it('validates reply permissions by role', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() => service.validateCanReply('staff')).not.toThrow();
      expect(() => service.validateCanReply('customer')).toThrow(ForbiddenException);
    });

    it('validates report permissions by role', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() => service.validateCanReport('staff')).not.toThrow();
      expect(() => service.validateCanReport('customer')).toThrow(ForbiddenException);
    });

    it('validates hide permissions (manager/admin only)', () => {
      const prisma = createMockPrisma();
      const service = new ReviewPermissionService(prisma as never);

      expect(() => service.validateCanHide('manager_owner')).not.toThrow();
      expect(() => service.validateCanHide('admin')).not.toThrow();
      expect(() => service.validateCanHide('staff')).toThrow(ForbiddenException);
    });
  });
});

