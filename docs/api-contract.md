# API Contract

Base URL:

```text
http://localhost:4000/api
```

Frontend must call the NestJS backend API. Do not call Supabase directly from the frontend for business operations.

## Response Format

Success:

```json
{
  "success": true,
  "data": {},
  "message": "optional message"
}
```

Error:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

## Existing Endpoints

### Health

```http
GET /api/health
```

Response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "co-phuc-rental-erp-backend"
  }
}
```

### Register

```http
POST /api/auth/register
```

Request:

```json
{
  "fullName": "Nguyen Van A",
  "email": "customer@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "customer@example.com",
    "fullName": "Nguyen Van A",
    "role": "customer"
  }
}
```

### Login

```http
POST /api/auth/login
```

Request:

```json
{
  "email": "customer@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-token",
    "user": {
      "id": "uuid",
      "email": "customer@example.com",
      "role": "customer"
    }
  }
}
```

### Google Login

```http
POST /api/auth/google
```

Request:

```json
{
  "idToken": "google-id-token"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-token",
    "user": {
      "id": "uuid",
      "email": "customer@example.com",
      "role": "customer"
    }
  }
}
```
### Me

```http
```

Returns the authenticated user profile and role information.

### Forgot Password

```http
POST /api/auth/forgot-password
```

Request:

```json
{
  "email": "customer@example.com"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "email": "customer@example.com"
  },
  "message": "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu."
}
```

### Reset Password

```http
POST /api/auth/reset-password
```

Request:

```json
{
  "token": "reset-token",
  "password": "Password123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "email": "customer@example.com"
  },
  "message": "Mật khẩu đã được đặt lại thành công. Bạn có thể đăng nhập lại."
}
```

### List Garments

```http
GET /api/garments
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Ao dai do theu sen",
      "categoryName": "Ao dai truyen thong",
      "sizeLabel": "M",
      "dailyPrice": 350000,
      "depositAmount": 1000000
    }
  ]
}
```

### Bookings

All booking endpoints require `Authorization: Bearer <accessToken>`.

#### Check Availability

```http
POST /api/bookings/check-availability
```

Request:

```json
{
  "garmentId": "uuid",
  "startDate": "2024-09-14",
  "endDate": "2024-09-16"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "garmentId": "uuid",
    "available": true,
    "conflictDates": []
  }
}
```

#### Create Booking

```http
POST /api/bookings
```

Request (`pickupMethod` and `note` optional):

```json
{
  "garmentSizeIds": ["uuid"],
  "startDate": "2024-09-14",
  "endDate": "2024-09-16",
  "pickupMethod": "store_pickup",
  "note": "Nhan tai atelier"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "pending_confirmation",
    "rentalStartDate": "2024-09-14",
    "rentalEndDate": "2024-09-16",
    "days": 3,
    "pickupMethod": "store_pickup",
    "rentalTotal": 1050000,
    "depositTotal": 1000000,
    "note": "Nhan tai atelier",
    "createdAt": "2024-09-10T08:00:00.000Z",
    "items": [
      {
        "id": "uuid",
        "garmentId": "uuid",
        "garmentName": "Ao dai do theu sen",
        "sizeLabel": "M",
        "dailyPrice": 350000,
        "depositAmount": 1000000
      }
    ]
  }
}
```

`rentalTotal = dailyPrice * days`. Server rejects with `400` if the garment is already booked over an overlapping date range.

#### List My Bookings

```http
GET /api/bookings/me
```

Returns an array of the authenticated customer's bookings (same shape as Create response), newest first.

#### Get Booking Detail

```http
GET /api/bookings/:id
```

Returns one booking. Responds `403` if the booking does not belong to the authenticated customer, `404` if not found.

#### Cancel Booking

```http
PATCH /api/bookings/:id/cancel
```

Sets status to `cancelled`. Only allowed while the booking is in `draft`, `pending_confirmation`, `confirmed`, or `awaiting_payment`; otherwise responds `400`.

## Planned Endpoints

### Auth/User

```http
GET /api/auth/me
PATCH /api/users/me/profile
PATCH /api/users/me/measurements
POST /api/users/me/addresses
GET /api/users/me/addresses
```

### Catalog and Assets

```http
POST /api/garments
PATCH /api/garments/:id
GET /api/garments/:id
POST /api/garments/:id/images
GET /api/assets
POST /api/assets
PATCH /api/assets/:id/status
```

Manager/Owner owns create/update catalog and asset operations.

### Booking (remaining, staff/manager)

```http
PATCH /api/bookings/:id/confirm
PATCH /api/bookings/:id/reject
PATCH /api/bookings/:id/mark-delivered
PATCH /api/bookings/:id/mark-returned
```

Booking creation, availability check, listing, detail, and customer cancel are implemented (see Existing Endpoints above). Booking creation runs on the backend and prevents double-booking of the same garment over overlapping dates.

### Chat

```http
PATCH /api/chat/conversations/:id/read
```

Marks a conversation as read for the authenticated user. Updates `customer_last_read_at` or `staff_last_read_at` depending on role. Called when user opens a conversation or receives a new message in an active conversation.

### Payment and Financial Management

```http
POST /api/payments/mock
GET /api/payments/booking/:bookingId
POST /api/refunds
POST /api/penalties
GET /api/reports/revenue
GET /api/reports/deposits
```

Do not let frontend directly set payment status as paid for real payment flows.

### Inspection and Staff Operation

```http
POST /api/inspections
GET /api/inspections/booking/:bookingId
POST /api/inspections/:id/findings
POST /api/inspections/:id/photos
POST /api/laundry-tickets
PATCH /api/laundry-tickets/:id/status
POST /api/maintenance-jobs
PATCH /api/maintenance-jobs/:id/status
```

### AI

```http
POST /api/ai/tryon-requests
GET /api/ai/tryon-requests/:id
POST /api/ai/damage-detection-requests
GET /api/ai/damage-detection-requests/:id
```

AI request flow must store consent and support failed/pending/completed states.

## API Change Rules

Before changing this contract:

1. Check if frontend or backend already depends on the endpoint.
2. Update this file.
3. Update DTOs and frontend types.
4. Add or update tests.
5. Mention the API change in the PR summary.