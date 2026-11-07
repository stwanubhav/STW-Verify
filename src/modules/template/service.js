/**
 * The sender brand is fixed and must never change from STW-Verify.
 */
const FIXED_SENDER = 'STW-Verify';

const DEFAULT_TEMPLATE = {
  appName: 'Zenox',
  senderName: FIXED_SENDER,
  subject: 'Your {app_name} OTP code',
  text: 'Hello,\n\nYour OTP code for {app_name} is {otp}.\nIt expires in {ttl_minutes} minute(s).\n\n— ' + FIXED_SENDER,
  html:
    '<p>Hello,</p>\n' +
    '<p>Your OTP code for <b>{app_name}</b> is <b>{otp}</b>.</p>\n' +
    '<p>It expires in {ttl_minutes} minute(s).</p>\n' +
    `<p style="color:#888">Sent securely by <b>${FIXED_SENDER}</b></p>`,
};

const ALLOWED_PLACEHOLDERS = ['{otp}', '{app_name}', '{ttl_minutes}'];

/**
 * Editable email template. Persisted via KV (file locally, Upstash on
 * Vercel) so changes survive cold starts.
 */
class TemplateService {
  constructor({ kv, key = 'message-template' }) {
    this.kv = kv;
    this.key = key;
    this._cache = null;
  }

  async load() {
    if (this._cache) return this._cache;
    let stored = {};
    try {
      const value = await this.kv.get(this.key);
      if (value && typeof value === 'object') stored = value;
    } catch {
      stored = {};
    }
    this._cache = { ...DEFAULT_TEMPLATE, ...stored, senderName: FIXED_SENDER };
    return this._cache;
  }

  async save(input) {
    const src = input && typeof input === 'object' ? input : {};
    const clean = {
      appName:
        typeof src.appName === 'string' && src.appName.trim()
          ? src.appName.trim().slice(0, 50)
          : DEFAULT_TEMPLATE.appName,
      senderName: FIXED_SENDER,
      subject: typeof src.subject === 'string' && src.subject.trim() ? src.subject : DEFAULT_TEMPLATE.subject,
      text: typeof src.text === 'string' && src.text.trim() ? src.text : DEFAULT_TEMPLATE.text,
      html: typeof src.html === 'string' && src.html.trim() ? src.html : DEFAULT_TEMPLATE.html,
    };

    for (const field of ['subject', 'text', 'html']) {
      const unknown = clean[field].match(/\{[a-z_]+\}/g)?.filter((p) => !ALLOWED_PLACEHOLDERS.includes(p));
      if (unknown && unknown.length) {
        const err = new Error(`Unsupported placeholder(s) in ${field}: ${unknown.join(', ')}`);
        err.code = 'INVALID_TEMPLATE';
        err.status = 400;
        throw err;
      }
    }

    await this.kv.set(this.key, clean);
    this._cache = clean;
    return clean;
  }

  async reset() {
    const clean = { ...DEFAULT_TEMPLATE };
    await this.kv.set(this.key, clean);
    this._cache = clean;
    return clean;
  }

  async render(vars) {
    const t = await this.load();
    const sub = (s) =>
      s
        .replace(/\{otp\}/g, String(vars.otp))
        .replace(/\{app_name\}/g, t.appName)
        .replace(/\{ttl_minutes\}/g, String(vars.ttlMinutes));
    return {
      subject: sub(t.subject),
      text: sub(t.text),
      html: sub(t.html),
      senderName: t.senderName,
    };
  }
}

module.exports = { TemplateService, DEFAULT_TEMPLATE, FIXED_SENDER };
