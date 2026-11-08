// n8n Code node "Compose email": builds subject/text/html from the verified payload.
// Every interpolated value is HTML-escaped in the html body; the subject/text are plain text.
const p = $input.first().json.payload;

const esc = (v) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
// Header-injection guard for the subject (CR/LF/control chars out, length cap).
// Also strips zero-width/bidi/format chars (spoofing, e.g. RLO) before escaping; mirrors convex/lib/validation.ts sanitizeText.
const line = (v) =>
  String(v)
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim()
    .slice(0, 120);

const tool = line(p.toolName);
const name = line(p.recipient.name || 'there');
const range = `${p.startDate} to ${p.endDate}`;

const templates = {
  request_created: {
    subject: `New borrow request for ${tool}`,
    body: `Someone asked to borrow "${tool}" from ${range}. Open LendLoop to approve or decline the request.`,
  },
  request_approved: {
    subject: `Your request for ${tool} was approved`,
    body: `Good news: your request to borrow "${tool}" (${range}) was approved. Please arrange the hand-over with the owner.`,
  },
  request_declined: {
    subject: `Your request for ${tool} was declined`,
    body: `Your request to borrow "${tool}" (${range}) was declined. You can browse other tools on LendLoop.`,
  },
  request_cancelled: {
    subject: `Request for ${tool} was cancelled`,
    body: `The request to borrow "${tool}" (${range}) was cancelled.`,
  },
  loan_returned: {
    subject: `${tool} was marked as returned`,
    body: `"${tool}" (${range}) was marked as returned. Thanks for lending and borrowing responsibly!`,
  },
};
const tpl = templates[p.eventType];
if (!tpl) {
  // Unknown type: fail loudly (error workflow + 5xx) rather than silently dropping the event.
  throw new Error('Unsupported eventType');
}

const text = `Hi ${name},\n\n${tpl.body}\n\n-- LendLoop`;
const html =
  `<p>Hi ${esc(name)},</p>` +
  `<p>${esc(tpl.body)}</p>` +
  `<p style="color:#666">LendLoop &middot; Borrow what you need. Lend what you don't.</p>`;

return [
  {
    json: {
      eventId: p.eventId,
      to: p.recipient.email,
      subject: tpl.subject,
      text,
      html,
    },
  },
];
