import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { logger } from '../../config/logger.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface IEmailClient {
  send(options: EmailOptions): Promise<void>;
}

export class EmailClient implements IEmailClient {
  private readonly transporter: Transporter;

  constructor(
    host: string,
    port: number,
    user: string,
    pass: string,
    private readonly fromEmail: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async send(options: EmailOptions): Promise<void> {
    logger.debug({ to: options.to, subject: options.subject }, 'Sending email');
    await this.transporter.sendMail({
      from: this.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }
}
