// ─────────────────────────────────────────────────────────────────────────────
// The quote as a PDF.
//
// pdfkit is already a dependency (the education side prints fee invoices with
// it), so a real attachment costs nothing extra. Same QuoteDocInput as the HTML
// document, so the PDF, the email and the public page cannot disagree.
//
// Standard PDF fonts have no rupee glyph, so amounts are written "INR 1,234.00"
// rather than with the symbol — a "?" in the total column is worse than the
// currency code.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit'
import type { QuoteDocInput } from './quote-document'

const INK = '#0f172a'
const MUTED = '#64748b'
const LINE = '#e2e8f0'
const ACCENT = '#4f46e5'

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

function money(v: unknown, currency: string): string {
  return `${currency} ${n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function date(v: Date | string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildQuotePdf(q: QuoteDocInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Quotation ${q.quoteNumber}` } })
      const chunks: Buffer[] = []
      doc.on('data', (c) => chunks.push(c as Buffer))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const left = 48
      const right = 547
      const width = right - left

      // ── Letterhead
      doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(q.from.name, left, 48, { width: 300 })
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      let y = 72
      for (const line of [q.from.email, q.from.phone, q.from.gstin ? `GSTIN ${q.from.gstin}` : null].filter(Boolean) as string[]) {
        doc.text(line, left, y)
        y += 12
      }

      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('QUOTATION', 380, 48, { width: 167, align: 'right', characterSpacing: 1.2 })
      doc.font('Courier-Bold').fontSize(16).fillColor(INK).text(q.quoteNumber, 380, 62, { width: 167, align: 'right' })
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      doc.text(`Issued ${date(q.issueDate)}`, 380, 84, { width: 167, align: 'right' })
      if (q.validUntil) doc.text(`Valid until ${date(q.validUntil)}`, 380, 96, { width: 167, align: 'right' })

      y = Math.max(y, 112) + 8
      doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(ACCENT).stroke()

      // ── Prepared for
      y += 18
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PREPARED FOR', left, y, { characterSpacing: 1 })
      y += 13
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(q.to.name, left, y)
      y += 16
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      for (const line of [
        q.to.contactName ? `Attn: ${q.to.contactName}` : null,
        q.to.address,
        q.to.email,
        q.to.gstin ? `GSTIN ${q.to.gstin}` : null,
      ].filter(Boolean) as string[]) {
        doc.text(line, left, y, { width })
        y += 12
      }

      // ── Table
      y += 14
      const cols = { item: left, qty: 330, rate: 380, disc: 440, tax: 480, amt: 520 }
      const header = (yy: number) => {
        doc.rect(left, yy, width, 20).fill('#f8fafc')
        doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
        doc.text('ITEM', cols.item + 8, yy + 6)
        doc.text('QTY', cols.qty, yy + 6, { width: 40, align: 'right' })
        doc.text('RATE', cols.rate, yy + 6, { width: 55, align: 'right' })
        doc.text('DISC', cols.disc, yy + 6, { width: 35, align: 'right' })
        doc.text('TAX', cols.tax, yy + 6, { width: 35, align: 'right' })
        doc.text('AMOUNT', cols.amt - 30, yy + 6, { width: 57, align: 'right' })
        return yy + 20
      }
      y = header(y)

      doc.font('Helvetica').fontSize(9).fillColor(INK)
      for (const l of q.items) {
        const nameH = doc.heightOfString(l.name, { width: 270 })
        const rowH = Math.max(20, nameH + (l.sku ? 12 : 0) + 8)
        if (y + rowH > 760) {
          doc.addPage()
          y = header(48)
          doc.font('Helvetica').fontSize(9).fillColor(INK)
        }
        doc.fillColor(INK).text(l.name, cols.item + 8, y + 5, { width: 270 })
        if (l.sku) doc.fillColor(MUTED).fontSize(8).text(l.sku, cols.item + 8, y + 5 + nameH, { width: 270 }).fontSize(9)
        doc.fillColor(INK)
        doc.text(String(n(l.quantity)), cols.qty, y + 5, { width: 40, align: 'right' })
        doc.text(money(l.unitPrice, q.currency), cols.rate, y + 5, { width: 55, align: 'right' })
        doc.text(`${n(l.discountPercent)}%`, cols.disc, y + 5, { width: 35, align: 'right' })
        doc.text(`${n(l.taxPercent)}%`, cols.tax, y + 5, { width: 35, align: 'right' })
        doc.font('Helvetica-Bold').text(money(l.total, q.currency), cols.amt - 30, y + 5, { width: 57, align: 'right' }).font('Helvetica')
        y += rowH
        doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke()
      }
      if (!q.items.length) {
        doc.fillColor(MUTED).text('No items on this quote.', left, y + 8, { width, align: 'center' })
        y += 28
      }

      // ── Totals
      y += 10
      if (y > 680) {
        doc.addPage()
        y = 48
      }
      const totalRow = (label: string, value: string, strong = false) => {
        doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9).fillColor(strong ? INK : MUTED)
        doc.text(label, 340, y, { width: 100, align: 'right' })
        doc.fillColor(INK).text(value, 445, y, { width: 102, align: 'right' })
        y += strong ? 18 : 14
      }
      totalRow('Subtotal', money(q.subtotal, q.currency))
      if (n(q.discount) > 0) totalRow('Discount', `- ${money(q.discount, q.currency)}`)
      totalRow('Tax', money(q.tax, q.currency))
      doc.moveTo(340, y).lineTo(right, y).lineWidth(1.2).strokeColor(INK).stroke()
      y += 6
      totalRow('Total', money(q.total, q.currency), true)

      // ── Terms & notes
      const blocks: [string, string][] = []
      if (q.paymentTerms) blocks.push(['PAYMENT TERMS', q.paymentTerms])
      if (q.deliveryTerms) blocks.push(['DELIVERY TERMS', q.deliveryTerms])
      if (q.notes) blocks.push(['NOTES', q.notes])
      if (blocks.length) {
        y += 16
        doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke()
        y += 12
        for (const [k, v] of blocks) {
          const h = doc.font('Helvetica').fontSize(9).heightOfString(v, { width })
          if (y + h + 24 > 780) {
            doc.addPage()
            y = 48
          }
          doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(k, left, y, { characterSpacing: 1 })
          y += 12
          doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, left, y, { width })
          y += h + 10
        }
      }

      // ── Footer
      y += 14
      if (y > 780) {
        doc.addPage()
        y = 48
      }
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke()
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
        `${q.preparedBy ? `Prepared by ${q.preparedBy}. ` : ''}This quotation is not a tax invoice.${q.validUntil ? ` Prices hold until ${date(q.validUntil)}.` : ''}`,
        left,
        y + 8,
        { width },
      )

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
