// n8n Code node "Summarize": turn the Error Trigger payload into a SAFE, short summary.
// - ids (loanId / eventId) are extracted first, only from "loanId=<id>" / "eventId=<id>" fragments
// - then emails, bearer tokens and long token-like strings are redacted, and the text is truncated
const input = $input.first().json;
const exec = input.execution || {};
const wf = input.workflow || {};
const rawMessage = String((exec.error && exec.error.message) || 'Unknown error');

const idOf = (key) => {
  const m = new RegExp(key + '[=:]\\s*([a-z0-9]{20,40})', 'i').exec(rawMessage);
  return m ? m[1] : undefined;
};
const loanId = idOf('loanId');
const eventId = idOf('eventId');

const redact = (s) =>
  String(s)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]')
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

const message = redact(rawMessage).slice(0, 300) || 'Unknown error';
const workflowName = redact(wf.name || 'unknown').slice(0, 100);
const executionId = String(exec.id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown';
const nodeName = redact(exec.lastNodeExecuted || '').slice(0, 100);

const event = { workflowName, executionId, message };
if (nodeName) event.nodeName = nodeName;
if (loanId) event.loanId = loanId;
if (eventId) event.eventId = eventId;

return [
  {
    json: {
      event,
      subject: `[LendLoop] n8n workflow failed: ${workflowName}`,
      text:
        `Workflow: ${workflowName}\nExecution: ${executionId}\nLast node: ${nodeName || 'n/a'}\n` +
        `Message: ${message}\n\nOpen n8n > Executions to investigate.`,
    },
  },
];
