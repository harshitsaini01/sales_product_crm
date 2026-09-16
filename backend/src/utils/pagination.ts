import type { PaginationQuery, PaginatedResult } from '../types'

export function parsePagination(query: PaginationQuery) {
  const page = Math.max(1, parseInt(query.page || '1', 10))
  const limit = Math.min(10000, Math.max(1, parseInt(query.limit || '25', 10)))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}
