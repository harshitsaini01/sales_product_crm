import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  mobile: z.string().max(20),
  role: z.enum(['counsellor', 'employee', 'franchise', 'agent']),
  branchId: z.number().int().optional(),
  designation: z.string().max(100).optional(),
  gender: z.string().max(20).optional(),
  dob: z.string().optional(),
  joiningDate: z.string().optional(),
  salary: z.number().int().optional(),
  address: z.string().optional(),
  city: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  country: z.string().max(50).optional(),
  departmentIds: z.array(z.number().int()).optional(), // Departments to assign
  automaticAsignLead: z.number().int().min(0).max(1).default(0),
  nickName: z.string().max(100).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
