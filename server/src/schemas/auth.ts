import { z } from 'zod';

export const farmerRegisterBackendSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters'),
  phone: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  state: z.string().min(1, 'State is required'),
  district: z.string().min(1, 'District is required'),
  block: z.string().min(1, 'Block is required'),
  village: z.string().min(1, 'Village is required'),
  pincode: z.string().optional(),
});



export const adminRegisterBackendSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters'),
  phone: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  state: z.string().min(1, 'State is required'),
  district: z.string().min(1, 'District is required'),
  adminSecret: z.string().min(1, 'Admin Creation Secret is required'),
});



export const loginSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number'),
  password: z.string().min(1, 'Password is required'),
});
