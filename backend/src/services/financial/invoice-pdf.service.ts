import PDFDocument from 'pdfkit'
import { prisma } from '../../lib/prisma'

interface BuildOptions {
  invoiceId: bigint
}

/**
 * Streams a generated invoice PDF as a Buffer.
 * Replicates the Common.GetInvoicePdf behaviour from the legacy CRM.
 */
export async function buildInvoicePdf({ invoiceId }: BuildOptions): Promise<Buffer> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { orderBy: { paidAt: 'asc' } },
      user: { select: { id: true, name: true, email: true, mobile: true } },
    },
  })
  if (!invoice) throw new Error('Invoice not found')

  const lead = await prisma.lead.findUnique({
    where: { id: invoice.leadId },
    select: {
      id: true, name: true, email: true, mobile: true,
      city: true, state: true, country: true, course: true,
    },
  })

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk as Buffer))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Header
      doc
        .fontSize(22).fillColor('#111827').font('Helvetica-Bold')
        .text('Tutelage Study', 50, 50)
        .fontSize(10).fillColor('#6B7280').font('Helvetica')
        .text('Educational Consultancy', 50, 75)
        .text('crm.tutelagestudy.com', 50, 88)

      doc
        .fontSize(28).fillColor('#111827').font('Helvetica-Bold')
        .text('INVOICE', 400, 50, { align: 'right' })
        .fontSize(11).fillColor('#374151').font('Helvetica')
        .text(`#${invoice.invoiceNo}`, 400, 80, { align: 'right' })
        .fillColor('#6B7280').fontSize(9)
        .text(`Issued: ${new Date(invoice.createdAt).toLocaleDateString()}`, 400, 95, { align: 'right' })
      if (invoice.dueDate) {
        doc.text(`Due: ${new Date(invoice.dueDate).toLocaleDateString()}`, 400, 108, { align: 'right' })
      }

      // Status pill
      const statusColors: Record<string, string> = {
        paid: '#059669',
        partial: '#D97706',
        pending: '#DC2626',
      }
      doc
        .roundedRect(450, 125, 95, 20, 4)
        .fill(statusColors[invoice.status.toLowerCase()] || '#6B7280')
        .fillColor('white').fontSize(9).font('Helvetica-Bold')
        .text(invoice.status.toUpperCase(), 450, 131, { width: 95, align: 'center' })

      // Bill-To block
      let y = 180
      doc
        .fillColor('#6B7280').fontSize(9).font('Helvetica-Bold')
        .text('BILL TO', 50, y)
        .fillColor('#111827').fontSize(13).font('Helvetica-Bold')
        .text(lead?.name || '—', 50, y + 14)
        .fillColor('#374151').fontSize(10).font('Helvetica')

      let by = y + 32
      if (lead?.email) { doc.text(lead.email, 50, by); by += 13 }
      if (lead?.mobile) { doc.text(lead.mobile, 50, by); by += 13 }
      const loc = [lead?.city, lead?.state, lead?.country].filter(Boolean).join(', ')
      if (loc) { doc.text(loc, 50, by); by += 13 }
      if (lead?.course) { doc.fillColor('#6B7280').text(`Course: ${lead.course}`, 50, by); by += 13 }

      // Line items table
      y = Math.max(by + 20, 280)
      doc
        .moveTo(50, y).lineTo(545, y).strokeColor('#E5E7EB').lineWidth(1).stroke()
        .fillColor('#6B7280').fontSize(9).font('Helvetica-Bold')
        .text('DESCRIPTION', 55, y + 8)
        .text('AMOUNT', 450, y + 8, { width: 90, align: 'right' })

      y += 28
      doc
        .fillColor('#111827').fontSize(11).font('Helvetica')
        .text(invoice.description || `Invoice ${invoice.invoiceNo}`, 55, y, { width: 380 })
        .font('Helvetica-Bold')
        .text(formatCurrency(Number(invoice.amount)), 450, y, { width: 90, align: 'right' })

      y += 30
      doc.moveTo(50, y).lineTo(545, y).stroke()

      // Payments
      const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0)
      const balance = Number(invoice.amount) - totalPaid

      y += 12
      if (invoice.payments.length > 0) {
        doc
          .fillColor('#6B7280').fontSize(9).font('Helvetica-Bold')
          .text('PAYMENTS RECEIVED', 50, y)
        y += 16
        for (const p of invoice.payments) {
          doc
            .fillColor('#374151').fontSize(10).font('Helvetica')
            .text(
              `${new Date(p.paidAt).toLocaleDateString()} · ${p.mode || 'cash'}${p.note ? ` · ${p.note}` : ''}`,
              55, y, { width: 380 },
            )
            .text(formatCurrency(Number(p.amount)), 450, y, { width: 90, align: 'right' })
          y += 16
        }
        y += 4
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#F3F4F6').stroke()
        y += 8
      }

      // Totals box
      const totalsX = 350
      const totalsW = 195
      doc
        .fillColor('#374151').fontSize(10).font('Helvetica')
        .text('Subtotal', totalsX, y, { width: 100 })
        .text(formatCurrency(Number(invoice.amount)), totalsX + 100, y, { width: 95, align: 'right' })
      y += 16
      if (totalPaid > 0) {
        doc
          .fillColor('#059669')
          .text('Paid', totalsX, y, { width: 100 })
          .text(`-${formatCurrency(totalPaid)}`, totalsX + 100, y, { width: 95, align: 'right' })
        y += 16
      }
      doc
        .moveTo(totalsX, y).lineTo(totalsX + totalsW, y).strokeColor('#E5E7EB').stroke()
      y += 8
      doc
        .fillColor('#111827').fontSize(13).font('Helvetica-Bold')
        .text('Balance Due', totalsX, y, { width: 100 })
        .text(formatCurrency(balance), totalsX + 100, y, { width: 95, align: 'right' })

      // Footer
      doc
        .fillColor('#9CA3AF').fontSize(8).font('Helvetica')
        .text(
          'Thank you for your business. For questions about this invoice, please contact us.',
          50, 760, { align: 'center', width: 495 },
        )

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

function formatCurrency(n: number): string {
  return `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
