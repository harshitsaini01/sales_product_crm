import type { ReactNode } from 'react'
import { Package } from 'lucide-react'

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      <aside className="auth-grid relative hidden lg:flex flex-col justify-between overflow-hidden border-r p-12">
        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <Package className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight text-slate-800">Sales CRM</div>
            <div className="text-xs text-slate-500">Product sales workspace</div>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-4xl font-semibold tracking-tight leading-[1.15] text-slate-800">
            From first lead to catalog sent.
          </h2>
          <p className="text-sm leading-relaxed text-slate-500">
            Capture enquiries, send product catalogs, and keep follow-ups in one calm workspace.
          </p>
          <ul className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Qualify leads through a simple status flow
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Send catalogs over email and WhatsApp
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Track owners, follow-ups, and daily work
            </li>
          </ul>
        </div>

        <p className="relative z-10 text-xs text-slate-400">
          Built for selling catalog products.
        </p>
      </aside>

      <main className="flex items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
              <Package className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-800">Sales CRM</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-800">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
