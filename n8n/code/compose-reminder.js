// n8n Code node "Compose reminder": one email per overdue loan (input = one item per loan after Split Out).
const esc = (v) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
// Also strips zero-width/bidi/format chars (spoofing, e.g. RLO) before escaping; mirrors convex/lib/validation.ts sanitizeText.
const line = (v) =>
  String(v)
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim()
    .slice(0, 120);

return $input.all().map((item) => {
  const l = item.json;
  const tool = line(l.toolName);
  const name = line(l.borrowerName || 'there');
  const days = Number(l.daysOverdue) || 0;
  const body =
    `"${tool}" was due back on ${l.endDate} and is now ${days} day${days === 1 ? '' : 's'} overdue. ` +
    `Please return it to its owner as soon as you can, or contact them to agree a new date.`;
  return {
    json: {
      loanId: l.loanId,
      to: l.borrowerEmail,
      subject: `Overdue: please return ${tool}`,
      text: `Hi ${name},\n\n${body}\n\n-- LendLoop`,
      html: `<p>Hi ${esc(name)},</p><p>${esc(body)}</p><p style="color:#666">LendLoop</p>`,
    },
    pairedItem: item.pairedItem,
  };
});
