import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30s — feels live without thrashing
      retry: 1,
      refetchOnWindowFocus: true, // tab back → fresh data
      refetchOnReconnect: true,
    },
    mutations: {
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        console.error('Mutation error:', msg || err)
      },
    },
  },
})
