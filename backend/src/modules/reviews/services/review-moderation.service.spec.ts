import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ReviewModerationService } from './review-moderation.service';

describe('ReviewModerationService', () => {
  const service = new ReviewModerationService();

  it('passes clean comments with neutral or positive sentiment', () => {
    const result = service.moderateContent('Áo dài rất đẹp, đường may tinh xảo và ưng ý');
    expect(result.isClean).toBe(true);
    expect(result.shouldBlock).toBe(false);
    expect(result.sentiment).toBe('positive');
  });

  it('detects negative sentiment', () => {
    const result = service.moderateContent('Vải bị cũ, mùi hôi và áo chật');
    expect(result.isClean).toBe(true);
    expect(result.shouldBlock).toBe(false);
    expect(result.sentiment).toBe('negative');
  });

  it('blocks severe toxic/vulgar language', () => {
    const result = service.moderateContent('Đồ lừa đảo vcl');
    expect(result.shouldBlock).toBe(true);
    expect(result.isClean).toBe(false);

    expect(() => service.assertContentAllowed('Đồ lừa đảo vcl')).toThrow(
      BadRequestException,
    );
  });

  it('flags spam links without throwing hard block', () => {
    const result = service.moderateContent('Vào web https://cacuoc-nhanh.xyz để nhận quà');
    expect(result.isClean).toBe(false);
    expect(result.shouldBlock).toBe(false);
    expect(result.containsSpamLinks).toBe(true);
    expect(result.flaggedReason).toContain('link liên kết');
  });

  it('flags phone numbers for staff verification', () => {
    const result = service.moderateContent('Liên hệ 0912345678 để thanh lý lại áo nhé');
    expect(result.isClean).toBe(false);
    expect(result.containsPhoneNumber).toBe(true);
    expect(result.flaggedReason).toContain('số điện thoại');
  });

  it('flags excessive repeated character spam', () => {
    const result = service.moderateContent('Áo đẹp quáaaaaaaaaaa');
    expect(result.isClean).toBe(false);
    expect(result.hasExcessiveRepeats).toBe(true);
  });

  it('extracts and embeds fit feedback properly', () => {
    const embedded = service.embedFitFeedback('Áo mặc rất tôn dáng', 'true_to_size');
    expect(embedded).toBe('[FIT:true_to_size] Áo mặc rất tôn dáng');

    const parsed = service.extractFitFeedback(embedded);
    expect(parsed.fitFeedback).toBe('true_to_size');
    expect(parsed.cleanComment).toBe('Áo mặc rất tôn dáng');
  });
});

