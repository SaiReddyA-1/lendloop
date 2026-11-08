// n8n Code node "Verify signature" (mode: Run Once for All Items).
// Needs NODE_FUNCTION_ALLOW_BUILTIN=crypto and LENDLOOP_WEBHOOK_SECRET in the n8n environment.
// Never log the payload, headers or secret.
const crypto = require('crypto');

const item = $input.first();
const headers = {};
for (const [k, v] of Object.entries(item.json.headers || {})) headers[k.toLowerCase()] = v;

const reject = () => [{ json: { valid: false, duplicate: false } }];

const secret = $env.LENDLOOP_WEBHOOK_SECRET;
if (!secret) return reject();

const ts = String(headers['x-lendloop-timestamp'] || '');
const sigHeader = String(headers['x-lendloop-signature'] || '');
if (!/^\d{1,12}$/.test(ts)) return reject();
const sigMatch = /^sha256=([0-9a-fA-F]{64})$/.exec(sigHeader);
if (!sigMatch) return reject();

// Replay window: +-300 s (ADR-021).
if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return reject();

// Raw body: webhook option "Raw Body" exposes the exact bytes as binary property `data`.
let raw;
try {
  raw = await this.helpers.getBinaryDataBuffer(0, 'data');
} catch (e) {
  return reject();
}

const expected = crypto.createHmac('sha256', secret).update(ts + '.').update(raw).digest();
const given = Buffer.from(sigMatch[1], 'hex');
// Equal lengths are guaranteed (32 bytes each), so timingSafeEqual cannot throw.
if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return reject();

let payload;
try {
  payload = JSON.parse(raw.toString('utf8'));
} catch (e) {
  return reject();
}
const s = (v) => typeof v === 'string';
if (
  !payload ||
  !s(payload.eventId) ||
  !s(payload.eventType) ||
  !s(payload.toolName) ||
  !payload.recipient ||
  !s(payload.recipient.email)
) {
  return reject();
}

// De-duplication (ADR-026): only events that were already EMAILED are recorded (see "Record event").
const staticData = $getWorkflowStaticData('global');
const seen = staticData.processedEvents || {};
const duplicate = Object.prototype.hasOwnProperty.call(seen, payload.eventId);

return [{ json: { valid: true, duplicate, payload } }];
