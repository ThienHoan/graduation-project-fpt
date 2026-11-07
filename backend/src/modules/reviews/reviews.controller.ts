import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @Post()
  create(@Req() req: any, @Body() createReviewDto: CreateReviewDto) {
    const customerId = req.user.id;
    return this.reviewsService.create(customerId, createReviewDto);
  }

  /**
   * Lấy dữ liệu thống kê tổng hợp của trang phục (không tải toàn bộ reviews)
   */
  @Get('garment/:garmentId/statistics')
  getGarmentStatistics(@Param('garmentId') garmentId: string) {
    return this.reviewsService.getGarmentStatistics(garmentId);
  }

  /**
   * Lấy danh sách đánh giá của trang phục kèm lọc, tìm kiếm, sắp xếp và phân trang
   */
  @Get('garment/:garmentId')
  findAllByGarment(
    @Param('garmentId') garmentId: string,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewsService.findAllByGarment(garmentId, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @Get('me')
  findAllByCustomer(@Req() req: any) {
    const customerId = req.user.id;
    return this.reviewsService.findAllByCustomer(customerId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() updateReviewDto: UpdateReviewDto,
  ) {
    const customerId = req.user.id;
    return this.reviewsService.update(id, customerId, updateReviewDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager_owner';
    return this.reviewsService.remove(id, userId, isAdmin);
  }

  // --- Staff & Manager Endpoints ---

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'manager_owner', 'admin')
  @Get('staff/all')
  findAllStaff() {
    return this.reviewsService.findAllStaff();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'manager_owner', 'admin')
  @Post(':id/reply')
  replyToReview(
    @Param('id') id: string,
    @Req() req: any,
    @Body() replyReviewDto: ReplyReviewDto,
  ) {
    const staffId = req.user.id;
    return this.reviewsService.replyToReview(id, staffId, replyReviewDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'manager_owner', 'admin')
  @Post(':id/report')
  reportReview(
    @Param('id') id: string,
    @Req() req: any,
    @Body() reportReviewDto: ReportReviewDto,
  ) {
    const staffId = req.user.id;
    return this.reviewsService.reportReview(id, staffId, reportReviewDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager_owner', 'admin')
  @Patch(':id/hide')
  hideReview(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.reviewsService.hideReview(id, body.reason);
  }
}
