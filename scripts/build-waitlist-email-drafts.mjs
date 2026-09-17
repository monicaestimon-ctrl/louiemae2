import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs/marketing');
const sequence = JSON.parse(fs.readFileSync(path.join(dir, 'waitlist-sequence.json'), 'utf8'));
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const previews = [];
for (const [index, email] of sequence.emails.entries()) {
  const content = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#f6f2e9;color:#43382d">
<tr><td style="padding:35px 24px;text-align:center;font-family:Georgia,serif;font-size:30px;letter-spacing:6px">LOUIE MAE</td></tr>
<tr><td><img src="https://www.louiemae.com/images/prelaunch/${email.image}" alt="${index === 0 ? 'Staggered ceramic vases in a sunlit room' : index === 1 ? 'An open book and olive branch on linen' : index === 2 ? 'An inviting living room with a rustic wood table' : 'A cream dress in a sunlit meadow'}" width="600" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:32px 32px 12px"><h1 style="font-family:Georgia,serif;font-size:30px;font-weight:normal;line-height:1.2;margin:0 0 24px">${escape(email.heading)}</h1>
${email.paragraphs.map(p => `<p style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;margin:0 0 20px">${escape(p)}</p>`).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#43382d" style="padding:16px 24px"><a href="${email.url}" style="color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;letter-spacing:1px">${escape(email.cta)}</a></td></tr></table>
<p style="font-family:Georgia,serif;font-size:18px;line-height:1.6;margin:28px 0">With love,<br>Louie Mae</p></td></tr>
<tr><td style="padding:24px 32px 32px;border-top:1px solid #ddd3c5;text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:1.8;color:#756858">
Live the life you love. Love the life you live.<br><br>You received this email because you joined the Louie Mae waitlist.<br>
{{ organization.full_address }}<br>{% unsubscribe 'Unsubscribe' %}</td></tr></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(email.subject)}</title></head><body style="margin:0;background:#eae4d9"><div style="display:none;max-height:0;overflow:hidden">${escape(email.preview)}</div>${content}</body></html>`;
  fs.writeFileSync(path.join(dir, `waitlist-${index + 1}.html`), html);
  previews.push(`<section><header><strong>DRAFT ${index + 1} · DAY ${email.day}</strong><h2>${escape(email.subject)}</h2><p>${escape(email.preview)}</p></header>${content.replace('{{ organization.full_address }}', '[Business mailing address — supplied in Klaviyo]').replace("{% unsubscribe 'Unsubscribe' %}", 'Unsubscribe')}</section>`);
}
fs.writeFileSync(path.join(dir, 'waitlist-review.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Louie Mae — Welcome Email Drafts</title><style>body{margin:0;background:#eae4d9;color:#43382d}main{max-width:680px;margin:auto;padding:32px 12px}header{font-family:Arial,sans-serif;padding:24px}section{margin-bottom:64px}h2{font-size:22px}aside{font-family:Arial,sans-serif;line-height:1.6;padding:24px;background:#fff9ed}</style></head><body><main><aside><strong>Louie Mae · Welcome sequence for review</strong><p>Drafts only. No emails are active or scheduled. Proposed sender: Louie Mae &lt;withlove@louiemae.com&gt;. Days are measured from joining the list. Final sender, mailing address, and reply inbox need confirmation.</p></aside>${previews.join('')}</main></body></html>`);
console.log('Created four Klaviyo HTML drafts and a review page. Nothing sent.');
