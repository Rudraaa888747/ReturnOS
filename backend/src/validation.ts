import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(120),
});

export const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotSchema = z.object({
  email: z.string().email('A valid email address is required'),
});

export const resetSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(100),
});

export const profilePatchSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
});

const prefsSchema = z.record(z.string(), z.boolean());

export const settingsPatchSchema = z.object({
  commPrefs: prefsSchema.optional(),
  notifPrefs: prefsSchema.optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(100),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

export const addressSchema = z.object({
  label: z.string().max(60).optional(),
  fullName: z.string().min(2).max(120),
  line1: z.string().min(2).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  postalCode: z.string().min(3).max(20),
  country: z.string().min(2).max(60).default('IN'),
  phone: z.string().min(6).max(20).optional(),
  isDefault: z.boolean().optional(),
});

export const addressPatchSchema = addressSchema.partial();

export const resolutionTypeSchema = z.enum(['REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT']);
export const pickupKindSchema = z.enum(['PICKUP', 'DROP_OFF']);

export const returnItemSchema = z.object({
  orderItemId: z.string().min(1, 'Order item id is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  reasonCode: z.string().min(1, 'Reason code is required'),
  description: z.string().max(1000).optional(),
});

export const returnCreateSchema = z.object({
  orderId: z.string().min(1, 'Order id is required'),
  items: z.array(returnItemSchema).min(1, 'At least one return item is required'),
  resolutionType: resolutionTypeSchema,
  description: z.string().max(2000).optional(),
  pickupKind: pickupKindSchema,
  pickupAddress: z.string().max(500).optional(),
  pickupDate: z.string().max(30).optional(),
  timeWindow: z.string().max(60).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().min(3, 'A cancellation reason is required').max(500),
});

export const ticketCreateSchema = z.object({
  subject: z.string().min(4, 'Subject must be at least 4 characters').max(200),
  body: z.string().min(1, 'Message body is required').max(4000),
  returnId: z.string().min(1).optional(),
});

export const messageCreateSchema = z.object({
  body: z.string().min(1, 'Message body is required').max(4000),
});

export const feedbackSchema = z.object({
  returnId: z.string().min(1, 'Return id is required'),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const notificationReadSchema = z.object({});

export const cartAddSchema = z.object({
  productId: z.string().min(1, 'Product id is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

export const cartSetSchema = z.object({
  quantity: z.number().int().min(0, 'Quantity must be a non-negative integer'),
});

export const quoteSchema = z.object({
  addressId: z.string().min(1, 'Address id is required'),
  useStoreCredit: z.boolean().optional().default(false),
});

export const checkoutSchema = z.object({
  addressId: z.string().min(1, 'Address id is required'),
  useStoreCredit: z.boolean().optional().default(false),
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotInput = z.infer<typeof forgotSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type AddressPatchInput = z.infer<typeof addressPatchSchema>;
export type ResolutionType = z.infer<typeof resolutionTypeSchema>;
export type PickupKind = z.infer<typeof pickupKindSchema>;
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;
export type MessageCreateInput = z.infer<typeof messageCreateSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
