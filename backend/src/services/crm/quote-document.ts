// ─────────────────────────────────────────────────────────────────────────────
// The quote as a document a customer can actually read.
//
// ONE RENDERER, THREE USES: the email body, the print/PDF view, and the
// customer-facing preview. Three templates would drift, and the version the
// customer received would stop matching the version the rep printed.
//
// WHY HTML AND NOT A GENERATED PDF
//
// A real PDF means puppeteer (a ~200MB headless Chrome in the deploy) or
// hand-laying-out with pdfkit. Both are a lot of weight for a document that has
// to arrive readable in an inbox anyway. So: the email body IS the document,
// and the browser's own "Print → Save as PDF" produces the file when somebody
// needs one. The trade is real — there is no PDF attachment — and it is worth
// making until a customer asks for one.
//
// EMAIL-SAFE HTML. Inline styles only, tables for layout, no flexbox or grid,
// no external stylesheet, no web fonts. Outlook renders none of those.
// ─────────────────────────────────────────────────────────────────────────────

export interface QuoteDocLine {
  name: string
  sku: string | null
  quantity: unknown
  unitPrice: unknown
  discountPercent: unknown
  taxPercent: unknown
  total: unknown
}

export interface QuoteDocInput {
  quoteNumber: string
  status: string
  issueDate: Date | string
  validUntil: Date | string | null
  currency: string
  subtotal: unknown
  discount: unknown
  tax: unknown
  total: unknown
  paymentTerms: string | null
  deliveryTerms: string | null
  notes: string | null
  items: QuoteDocLine[]
  /** The customer's own company — whose letterhead this is. */
  from: { name: string; email?: string | null; phone?: string | null; gstin?: string | null }
  /** Who it is addressed to. */
  to: { name: string; contactName?: string | null; email?: string | null; gstin?: string | null; address?: string | null }
  preparedBy?: string | null
}

/** Escape anything that lands inside markup. Notes and terms are user text. */
function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

function money(v: unknown, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `
  return `${symbol}${n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function date(v: Date | string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const C = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  head: '#f8fafc',
  accent: '#4f46e5',
}

export function renderQuoteHtml(q: QuoteDocInput): string {
  const rows = q.items
    .map(
      (l, i) => `
      <tr style="background:${i % 2 ? '#fbfcfe' : '#ffffff'}">
        <td style="padding:10px 12px;border-bottom:1px solid ${C.line};color:${C.ink};font-size:13px">
          ${esc(l.name)}
          ${l.sku ? `<div style="color:${C.muted};font-size:11px;margin-top:2px">${esc(l.sku)}</div>` : ''}
        </td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${C.line};font-size:13px">${n(l.quantity)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${C.line};font-size:13px">${money(l.unitPrice, q.currency)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${C.line};font-size:13px">${n(l.discountPercent)}%</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${C.line};font-size:13px">${n(l.taxPercent)}%</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${C.line};font-size:13px;font-weight:600">${money(l.total, q.currency)}</td>
      </tr>`,
    )
    .join('')

  const totalRow = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:5px 12px;text-align:right;color:${strong ? C.ink : C.muted};font-size:${strong ? '15px' : '13px'};${strong ? 'font-weight:700' : ''}">${label}</td>
      <td align="right" style="padding:5px 12px;width:140px;color:${C.ink};font-size:${strong ? '17px' : '13px'};font-weight:${strong ? '700' : '600'}">${value}</td>
    </tr>`

  const terms = [
    q.paymentTerms ? ['Payment terms', q.paymentTerms] : null,
    q.deliveryTerms ? ['Delivery terms', q.deliveryTerms] : null,
  ].filter(Boolean) as [string, string][]

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(q.quoteNumber)}</title>
<style>
  @media print {
    @page { margin: 14mm; }
    .no-print { display: none !important; }
    body { background: #fff !important; }
    .sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; max-width: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink}">
<div class="sheet" style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid ${C.line};border-radius:10px;overflow:hidden">

  <!-- Letterhead -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>
      <td style="padding:26px 28px 18px 28px;border-bottom:3px solid ${C.accent}">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top">
              <div style="font-size:19px;font-weight:700;letter-spacing:-0.2px">${esc(q.from.name)}</div>
              <div style="color:${C.muted};font-size:12px;margin-top:4px;line-height:1.6">
                ${q.from.email ? `${esc(q.from.email)}<br>` : ''}
                ${q.from.phone ? `${esc(q.from.phone)}<br>` : ''}
                ${q.from.gstin ? `GSTIN ${esc(q.from.gstin)}` : ''}
              </div>
            </td>
            <td align="right" style="vertical-align:top">
              <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};font-weight:600">Quotation</div>
              <div style="font-size:20px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:3px">${esc(q.quoteNumber)}</div>
              <div style="color:${C.muted};font-size:12px;margin-top:6px;line-height:1.7">
                Issued <strong style="color:${C.ink}">${date(q.issueDate)}</strong><br>
                ${q.validUntil ? `Valid until <strong style="color:${C.ink}">${date(q.validUntil)}</strong>` : ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Addressed to -->
    <tr>
      <td style="padding:20px 28px 6px 28px">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};font-weight:600">Prepared for</div>
        <div style="font-size:15px;font-weight:600;margin-top:5px">${esc(q.to.name)}</div>
        <div style="color:${C.muted};font-size:12px;margin-top:3px;line-height:1.6">
          ${q.to.contactName ? `Attn: ${esc(q.to.contactName)}<br>` : ''}
          ${q.to.address ? `${esc(q.to.address)}<br>` : ''}
          ${q.to.email ? `${esc(q.to.email)}<br>` : ''}
          ${q.to.gstin ? `GSTIN ${esc(q.to.gstin)}` : ''}
        </div>
      </td>
    </tr>

    <!-- Lines -->
    <tr>
      <td style="padding:18px 28px 0 28px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.line};border-radius:6px">
          <thead>
            <tr style="background:${C.head}">
              <th align="left" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Item</th>
              <th align="right" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Qty</th>
              <th align="right" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Rate</th>
              <th align="right" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Disc</th>
              <th align="right" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Tax</th>
              <th align="right" style="padding:9px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" style="padding:28px;text-align:center;color:${C.muted};font-size:13px">No items on this quote.</td></tr>`}</tbody>
        </table>
      </td>
    </tr>

    <!-- Totals -->
    <tr>
      <td style="padding:14px 28px 0 28px">
        <table align="right" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:300px">
          ${totalRow('Subtotal', money(q.subtotal, q.currency))}
          ${n(q.discount) > 0 ? totalRow('Discount', `− ${money(q.discount, q.currency)}`) : ''}
          ${totalRow('Tax', money(q.tax, q.currency))}
          <tr><td colspan="2" style="padding:4px 12px"><div style="border-top:2px solid ${C.ink}"></div></td></tr>
          ${totalRow('Total', money(q.total, q.currency), true)}
        </table>
      </td>
    </tr>

    ${
      terms.length || q.notes
        ? `<tr><td style="padding:34px 28px 0 28px">
            <div style="border-top:1px solid ${C.line};padding-top:16px">
              ${terms
                .map(
                  ([k, v]) =>
                    `<div style="margin-bottom:8px"><span style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};font-weight:600">${esc(k)}</span><div style="font-size:13px;margin-top:2px">${esc(v)}</div></div>`,
                )
                .join('')}
              ${
                q.notes
                  ? `<div style="margin-top:10px"><span style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted};font-weight:600">Notes</span><div style="font-size:13px;margin-top:2px;white-space:pre-wrap;line-height:1.6">${esc(q.notes)}</div></div>`
                  : ''
              }
            </div>
          </td></tr>`
        : ''
    }

    <tr>
      <td style="padding:26px 28px 26px 28px">
        <div style="border-top:1px solid ${C.line};padding-top:14px;color:${C.muted};font-size:11px;line-height:1.7">
          ${q.preparedBy ? `Prepared by ${esc(q.preparedBy)}. ` : ''}This quotation is not a tax invoice.
          ${q.validUntil ? `Prices hold until ${date(q.validUntil)}.` : ''}
        </div>
      </td>
    </tr>
  </table>
</div>
</body></html>`
}

/** The short covering note the document is sent with. */
export function renderQuoteEmailIntro(q: QuoteDocInput, message?: string | null): string {
  const body = message?.trim()
    ? `<p style="font-size:14px;line-height:1.7;margin:0 0 18px 0;white-space:pre-wrap">${esc(message)}</p>`
    : `<p style="font-size:14px;line-height:1.7;margin:0 0 18px 0">Hello${
        q.to.contactName ? ` ${esc(q.to.contactName.split(' ')[0])}` : ''
      },<br><br>Please find our quotation <strong>${esc(q.quoteNumber)}</strong> below${
        q.validUntil ? `, valid until <strong>${date(q.validUntil)}</strong>` : ''
      }. Do come back to us with any questions.</p>`

  return `<div style="max-width:760px;margin:0 auto;padding:0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink}">${body}</div>`
}
