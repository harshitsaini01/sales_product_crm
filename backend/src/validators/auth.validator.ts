import { z } from 'zod';

export const loginSchema = z.object({
  loginid: z.string().min(1, 'Login ID is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
