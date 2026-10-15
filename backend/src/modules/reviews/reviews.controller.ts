import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
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
    console.log('[DEBUG ReviewsController.create] raw body:', JSON.stringify(req.body));
    console.log('[DEBUG ReviewsController.create] DTO:', JSON.stringify(createReviewDto));
    const customerId = req.user.id;
    return this.reviewsService.create(customerId, createReviewDto);
  }

  @Get('garment/:garmentId')
  findAllByGarment(
    @Param('garmentId') garmentId: string,
    @Query('rating') rating?: string,
    @Query('hasMedia') hasMedia?: string,
    @Query('fit') fit?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviewsService.findAllByGarment(garmentId, {
      rating: rating ? parseInt(rating, 10) : undefined,
      hasMedia: hasMedia !== undefined ? hasMedia === 'true' : undefined,
      fit: fit || undefined,
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(50, Math.max(1, parseInt(limit, 10))) : 10,
    });
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
  update(@Param('id') id: string, @Req() req: any, @Body() updateReviewDto: UpdateReviewDto) {
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
    @Body() replyReviewDto: import('./dto/reply-review.dto').ReplyReviewDto,
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
    @Body() reportReviewDto: import('./dto/report-review.dto').ReportReviewDto,
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
