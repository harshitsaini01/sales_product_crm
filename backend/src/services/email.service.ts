import nodemailer from 'nodemailer'
import { currentTenant } from '../lib/tenant-context'

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  /**
   * `path` reads a file off disk; `content` takes a Buffer or string that was
   * generated in memory. Generated documents (a quote, an invoice) never touch
   * the filesystem, so they need the second form.
   */
  attachments?: Array<{ filename: string; path?: string; content?: Buffer | string; contentType?: string }>
  /**
   * Override the display name. Defaults to the CURRENT CUSTOMER's company name,
   * which is the whole point — see below.
   */
  fromName?: string
  /** Threading — the reply lands under the same conversation in the client's inbox. */
  inReplyTo?: string
  references?: string[]
  headers?: Record<string, string>
}

class EmailService {
  private getTransporter() {
    const host = process.env.SMTP_HOST || 'celestial.herosite.pro'
    const port = Number(process.env.SMTP_PORT) || 465
    const user = process.env.SMTP_USER || 'contact@tutelagestudy.com'
    const pass = process.env.SMTP_PASS || 'Workspace@2026'

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    })
  }

  /**
   * Who the recipient sees this from.
   *
   * This used to be the literal string "Tutelage Study" for every message the
   * system sent. That was fine when there was one customer; with several it
   * means Britannica's quote arrives from a medical-admissions consultancy,
   * which is worse than no branding at all.
   *
   * The envelope address still belongs to the platform's SMTP account — one
   * mailbox is what the credentials allow — but the display name is the
   * customer's, so the inbox shows the right company.
   */
  private displayName(explicit?: string): string {
    if (explicit) return explicit
    // No tenant context (a background job, or the platform itself) falls back
    // to the configured default rather than throwing mid-send.
    return currentTenant()?.companyName || process.env.SMTP_FROM_NAME || 'Sales CRM'
  }

  async send(options: SendEmailOptions) {
    const transporter = this.getTransporter()
    const fromAddr = process.env.SMTP_FROM || 'contact@tutelagestudy.com'

    // A display name containing a quote or newline would break the header, so
    // strip anything that could escape it.
    const name = this.displayName(options.fromName).replace(/["\r\n\\]/g, '').slice(0, 78)

    const info = await transporter.sendMail({
      from: options.from || `"${name}" <${fromAddr}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo,
      cc: Array.isArray(options.cc) ? options.cc.join(', ') : options.cc,
      bcc: Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc,
      attachments: options.attachments,
      inReplyTo: options.inReplyTo,
      references: options.references,
      headers: options.headers,
    })

    return info
  }

  async verify() {
    return this.getTransporter().verify()
  }
}

export const emailService = new EmailService()
