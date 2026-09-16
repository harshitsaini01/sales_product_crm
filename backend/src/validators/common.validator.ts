import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(25),
});

export const bulkIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'At least one ID required'),
});
