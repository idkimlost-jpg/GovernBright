import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export interface Mailer { send(mail: Mail): Promise<void> }

// Development fallback: prints mail to the log so reset links can be followed locally.
// In production without SMTP it records only that a message was dropped, never its body.
export class LogMailer implements Mailer {
  constructor(private readonly includeBody: boolean) {}
  async send(mail: Mail): Promise<void> {
    if (this.includeBody) console.info(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    else console.warn(`[mail] SMTP_URL is not configured; dropped "${mail.subject}" to ${mail.to}`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> { this.sent.push(mail); }
}
