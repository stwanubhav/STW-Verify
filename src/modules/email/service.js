const nodemailer = require('nodemailer');
const logger = require('../../lib/logger');

class EmailService {
  constructor(config, templateService, credentialsService) {
    this.config = config;
    this.template = templateService;
    this.credentials = credentialsService;
    this._transport = null;
    this._transportKey = null;
  }

  async _getTransport() {
    const creds = await this.credentials.get();
    const key = `${creds.emailUser}|${creds.emailPass}`;
    if (!this._transport || this._transportKey !== key) {
      this._transport = nodemailer.createTransport({
        host: this.config.emailHost,
        port: this.config.emailPort,
        secure: this.config.emailSecure,
        auth: {
          user: creds.emailUser,
          pass: creds.emailPass,
        },
      });
      this._transportKey = key;
    }
    return this._transport;
  }

  /**
   * Send an OTP email using the editable message template.
   * Sender identity is always the fixed STW-Verify brand.
   */
  async sendOtpEmail(to, otp) {
    const ttlMinutes = Math.max(1, Math.round(this.config.otpTtlMs / 60000));
    const { subject, text, html, senderName } = await this.template.render({
      otp: String(otp),
      ttlMinutes,
    });

    if (this.config.emailTransport === 'console') {
      logger.warn(`[mail:console] ${senderName} OTP for ${to}: ${otp}`);
      logger.info(`[mail:console] subject: ${subject}`);
      return { messageId: 'console', accepted: [to] };
    }

    const creds = await this.credentials.get();
    const from = `${senderName} <${creds.emailUser}>`;
    const transport = await this._getTransport();
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return info;
  }
}

module.exports = { EmailService };
