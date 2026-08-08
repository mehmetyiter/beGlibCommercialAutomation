import { HOST_PROSPECT_CTA_URL_PATTERN } from './host-prospect-contract.mjs';
import { hashBody, normalizeEmail } from './outreach-store.mjs';

const MAX_SUBJECT_LENGTH = 180;
const FOOTER_SEPARATOR = '--';

// Reused from the v1 contract snapshot rather than re-declared, so the shape the renderer
// accepts can never drift from the shape Conversio actually mints.
const CTA_URL_REGEX = new RegExp(HOST_PROSPECT_CTA_URL_PATTERN);

// What the operator sees in the dashboard. The claim token is a bearer credential: the
// repository's data governance forbids CTA tokens in browser bundles, localStorage,
// exports, and dossier JSON, so the preview shows the link with its token masked while
// the approval still binds to the hash of the real message.
const CTA_DISPLAY_MASK = '[token hidden - revealed only to the send step]';

/**
 * Canonical outreach copy. The local outreach server renders every message from this
 * module so the dashboard can never submit a hand-edited body that skips the footer.
 */
export const outreachTemplates = [
  {
    id: 'tmpl-default',
    category: 'default',
    name: 'General host invitation',
    subject: 'A possible beGlib host collaboration',
    previewText: 'Short, respectful first-touch invitation for public professional contacts.',
    body: `Hi {{name}},

I am reaching out from beGlib because your work on {{topics}} feels aligned with the kind of thoughtful conversations we want to support.

We are exploring a small group of potential hosts for pilot conversations. The first step would simply be a short discovery call to understand whether the format, timing, and audience fit make sense for you.

If this is not relevant, you can reply "no thanks" and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy'],
  },
  {
    id: 'tmpl-host-invite',
    category: 'default',
    name: 'Host invitation with claim link',
    previewText: 'First-touch invitation that carries the Conversio claim link. Requires an issued Host prospect.',
    subject: 'Your beGlib host invitation',
    // Conversio owns the claim journey but has no invitation template of its own: if this
    // system does not send the mail, nobody does. The CTA must reach the recipient exactly
    // as Conversio minted it, fragment included.
    requiresCta: true,
    body: `Hi {{name}},

We have been following your work on {{topics}}, and we would like to invite you to host conversations on beGlib.

If you would like to take this up, you can claim your host invitation here:

{{ctaUrl}}

The link is personal to you and expires on {{ctaExpiresAt}}. Opening it starts a short verification step, and nothing is published until you finish setting things up yourself.

If this is not for you, no action is needed and we will not write again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'commercial'],
  },
  {
    id: 'tmpl-academia',
    category: 'academia',
    name: 'Academic invitation',
    subject: 'Exploring a host-led knowledge conversation',
    previewText: 'For faculty, researchers, scholars, and institute profiles.',
    body: `Hi {{name}},

Your work across {{topics}} stood out while we were researching people who can host nuanced, high-trust knowledge sessions.

beGlib is preparing a limited pilot for expert-led conversations. We would like to understand whether a carefully scoped session with your audience and expertise could be useful.

Would you be open to a brief call or to having us send a one-page overview?

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'commercial'],
  },
  {
    id: 'tmpl-science',
    category: 'science',
    name: 'Science communicator invitation',
    subject: 'A science host pilot that may fit your audience',
    previewText: 'For scientists, labs, explainers, and public science voices.',
    body: `Hi {{name}},

We found your work around {{topics}} and think your communication style may fit a beGlib host pilot we are shaping.

The idea is to help credible experts lead accessible conversations without turning the format into a generic webinar. We would love to share the pilot outline and hear whether this could be useful for your community.

If you prefer not to receive this kind of note, reply and we will remove this contact route.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy'],
  },
  {
    id: 'tmpl-creator',
    category: 'youtube',
    name: 'Creator partnership invitation',
    subject: 'Potential host format for your community',
    previewText: 'For YouTube-first creators and video-native educators.',
    body: `Hi {{name}},

Your channel and work on {{topics}} made us think there may be a natural fit with a beGlib host pilot.

We are looking for creators who already have a trusted voice and may want a structured way to host deeper conversations with their audience. We can send a short overview first; no commitment needed.

Best,
beGlib team`,
    requiredReview: ['brand', 'commercial', 'privacy'],
  },
  {
    id: 'tmpl-faith',
    category: 'religion',
    name: 'Sensitive-category inquiry',
    subject: 'Carefully scoped conversation inquiry',
    previewText: 'Requires human approval before use for faith or sensitive community contexts.',
    body: `Hi {{name}},

We are researching trusted community voices for a carefully moderated conversation format. Your work around {{topics}} appears relevant, but we would want to approach any discussion with the right context and care.

If open, we can send a short overview for review. If this is not appropriate, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-psychology',
    category: 'psychology',
    name: 'Psychology expert inquiry',
    subject: 'Carefully scoped psychology conversation inquiry',
    previewText: 'Requires human, privacy, and legal review before use for psychology voices.',
    body: `Hi {{name}},

We are researching qualified voices who can host careful, evidence-aware conversations around {{topics}}.

Because this area touches mental health and public trust, we would only proceed with clear scope, accurate positioning, and appropriate review. If open, we can send a short overview for consideration.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-therapy',
    category: 'therapy',
    name: 'Therapy educator inquiry',
    subject: 'Carefully scoped mental-health education inquiry',
    previewText: 'Requires extra review for therapists, counselors, and mental-health educators.',
    body: `Hi {{name}},

We are exploring expert-led conversation formats and found your public work around {{topics}}.

For therapy and mental-health education contexts, we would want the scope to be careful, non-clinical, and reviewed before anything is shared publicly. If appropriate, we can send a concise overview first.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-medicine',
    category: 'medicine',
    name: 'Medical expert inquiry',
    subject: 'Carefully scoped medical education conversation inquiry',
    previewText: 'Requires legal/clinical review before use for doctors and medical educators.',
    body: `Hi {{name}},

We are researching medical and public-health voices who may be a fit for carefully moderated educational conversations around {{topics}}.

We would treat this as an expert-led education format, not medical advice, and would only proceed after the scope and wording are reviewed. If open, we can send a short overview.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
];

export function listTemplates() {
  return outreachTemplates.map(({ body, ...rest }) => ({
    ...rest,
    requiresCta: rest.requiresCta === true,
    bodyLength: body.length,
  }));
}

/**
 * Validates a CTA before it can enter a message. Conversio mints the URL; a self-built or
 * reshaped one cannot validate on the claim side, so this checks the exact contract shape
 * and then that the origin is one the operator has explicitly allowlisted.
 */
export function validateCtaUrl(ctaUrl, allowedOrigins) {
  const errors = [];
  const value = typeof ctaUrl === 'string' ? ctaUrl.trim() : '';

  if (!value) {
    return { ok: false, errors: ['This template requires a Conversio claim link, but none was supplied.'] };
  }

  if (!CTA_URL_REGEX.test(value)) {
    errors.push(
      'The claim link does not match the v1 contract shape (https://<host>/host/invite#t=<43 characters>). Use the URL Conversio returned, unmodified.',
    );
  }

  try {
    const origin = new URL(value).origin;

    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
      errors.push('HOST_PROSPECT_ALLOWED_CTA_ORIGINS must list at least one origin before a claim link can be sent.');
    } else if (!allowedOrigins.includes(origin)) {
      errors.push(`Claim link origin ${origin} is not allowlisted.`);
    }
  } catch {
    errors.push('The claim link is not an absolute URL.');
  }

  return { ok: errors.length === 0, errors };
}

/** Masks the bearer token while leaving the link recognisable. */
export function maskCtaUrl(ctaUrl) {
  return typeof ctaUrl === 'string' ? ctaUrl.replace(/#t=[A-Za-z0-9_-]+$/, `#t=${CTA_DISPLAY_MASK}`) : '';
}

export function getTemplate(templateId) {
  return outreachTemplates.find((template) => template.id === templateId) ?? null;
}

export function getTemplateForCategory(category) {
  return (
    outreachTemplates.find((template) => template.category === category) ??
    outreachTemplates.find((template) => template.category === 'default') ??
    outreachTemplates[0]
  );
}

function formatTopics(topics) {
  const cleaned = (Array.isArray(topics) ? topics : [])
    .map((topic) => (typeof topic === 'string' ? topic.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);

  if (cleaned.length === 0) {
    return '';
  }

  return cleaned.join(', ').toLowerCase();
}

/**
 * The footer carries the three things a commercial message legally cannot ship without:
 * an accurate sender identity, a valid postal address, and a working opt-out route. It is
 * appended after rendering rather than embedded in templates so no template can drop it.
 */
export function renderComplianceFooter({ config, recipientEmail, sourceUrl }) {
  const lines = [FOOTER_SEPARATOR, ''];

  lines.push(
    sourceUrl
      ? `You are receiving this one-time message at ${recipientEmail} because it is published as a professional contact route on ${sourceUrl}.`
      : `You are receiving this one-time message at ${recipientEmail} because it is published as a public professional contact route.`,
  );
  lines.push('');
  lines.push(config.senderLegalName);
  lines.push(config.physicalMailingAddress);
  lines.push('');
  lines.push(
    `To opt out, reply to this message with "no thanks" or email ${config.unsubscribeMailto}. We will remove this contact route and will not write again.`,
  );

  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Plain, self-contained HTML: no remote images, no tracking pixel, no external CSS.
 * Anything loaded from a third party would leak recipient behaviour and hurt deliverability.
 *
 * `ctaUrl`, when present, becomes the one anchor in the message and its href is the exact
 * string Conversio returned. Nothing rewrites it: a tracker or shortener that drops the
 * `#t=` fragment produces an invitation that looks fine and cannot be claimed.
 */
function toHtml(bodyText, footerText, ctaUrl) {
  const linkify = (escaped) => {
    if (!ctaUrl) {
      return escaped;
    }

    return escaped.replaceAll(
      escapeHtml(ctaUrl),
      `<a href="${escapeHtml(ctaUrl)}" style="color:#17423c;font-weight:600;">${escapeHtml(ctaUrl)}</a>`,
    );
  };

  const paragraphs = (block) =>
    block
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${linkify(escapeHtml(paragraph)).replaceAll('\n', '<br />')}</p>`)
      .join('\n');

  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1f26;max-width:560px;">',
    paragraphs(bodyText),
    '<hr style="border:none;border-top:1px solid #d8dce4;margin:24px 0 16px;" />',
    `<div style="font-size:12px;line-height:1.5;color:#5b6270;">${paragraphs(
      footerText.replace(`${FOOTER_SEPARATOR}\n\n`, ''),
    )}</div>`,
    '</div>',
  ].join('\n');
}

/**
 * Builds the exact bytes that will be handed to SES. `bodyHash` binds an approval to
 * this precise content, so editing the message after approval invalidates the approval.
 */
export function renderOutreachMessage({ config, template, candidate, contact, invite }) {
  const errors = [];
  const recipientEmail = normalizeEmail(contact?.email);
  const displayName = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  const topics = formatTopics(candidate?.topics);

  if (!template) {
    return { ok: false, errors: ['Unknown outreach template.'] };
  }

  const ctaUrl = template.requiresCta ? (invite?.ctaUrl ?? '') : '';

  if (template.requiresCta) {
    const ctaResult = validateCtaUrl(ctaUrl, config.allowedCtaOrigins);
    errors.push(...ctaResult.errors);

    if (!invite?.expiresAt || Number.isNaN(Date.parse(invite.expiresAt))) {
      errors.push('The invitation needs the prospect expiry Conversio returned.');
    }
  } else if (invite?.ctaUrl) {
    errors.push(`Template ${template.id} does not carry a claim link; use tmpl-host-invite instead.`);
  }

  if (!recipientEmail) {
    errors.push('A verified recipient email address is required.');
  }

  if (!displayName) {
    errors.push('Candidate display name is required; the greeting cannot be left blank.');
  }

  if (!topics) {
    errors.push('At least one candidate topic is required so the message can state why they were contacted.');
  }

  if (!config.senderLegalName || !config.physicalMailingAddress || !config.unsubscribeMailto) {
    errors.push('Sender legal name, physical mailing address, and unsubscribe mailbox must all be configured.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const fill = (source, cta) =>
    source
      .replaceAll('{{name}}', displayName)
      .replaceAll('{{topics}}', topics)
      .replaceAll('{{ctaUrl}}', cta)
      .replaceAll('{{ctaExpiresAt}}', invite?.expiresAt ? formatExpiry(invite.expiresAt) : '');

  const bodyText = fill(template.body, ctaUrl);

  const unresolved = bodyText.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    return { ok: false, errors: [`Template placeholders were not resolved: ${unresolved.join(', ')}`] };
  }

  const footerText = renderComplianceFooter({
    config,
    recipientEmail,
    sourceUrl: contact?.sourceUrl ?? '',
  });

  const subject = template.subject.replaceAll('{{name}}', displayName).trim();

  if (!subject || subject.length > MAX_SUBJECT_LENGTH || /[\r\n]/.test(subject)) {
    return { ok: false, errors: ['Subject must be a single non-empty line under 180 characters.'] };
  }

  const base = {
    templateId: template.id,
    requiredReview: template.requiredReview,
    subject,
    from: config.fromAddress,
    fromDisplay: config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress,
    replyTo: config.replyToAddress,
    to: recipientEmail,
    headers: [{ name: 'List-Unsubscribe', value: `<mailto:${config.unsubscribeMailto}?subject=unsubscribe>` }],
    requiresCta: template.requiresCta === true,
  };

  const message = {
    ...base,
    bodyText: `${bodyText}\n\n${footerText}\n`,
    bodyHtml: toHtml(bodyText, footerText, ctaUrl),
    ctaUrl: ctaUrl || null,
    ctaExpiresAt: invite?.expiresAt ?? null,
    prospectId: invite?.prospectId ?? null,
  };

  message.bodyHash = hashBody(message.to, message.subject, message.bodyText, message.bodyHtml);

  // The approval binds to the hash of the real message above; this masked twin exists only
  // so the operator can read what will be sent without the bearer token reaching a browser.
  const maskedBody = fill(template.body, maskCtaUrl(ctaUrl));
  const displayMessage = {
    ...base,
    bodyText: `${maskedBody}\n\n${footerText}\n`,
    bodyHtml: toHtml(maskedBody, footerText, ''),
    bodyHash: message.bodyHash,
    ctaUrl: ctaUrl ? maskCtaUrl(ctaUrl) : null,
    ctaExpiresAt: invite?.expiresAt ?? null,
    prospectId: invite?.prospectId ?? null,
  };

  return { ok: true, message, displayMessage };
}

function formatExpiry(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Last line of defence before the provider call: re-checks the rendered bytes rather than
 * trusting that whoever built them ran the renderer.
 */
export function validateRenderedMessage(config, message) {
  const errors = [];

  if (!message?.subject?.trim()) {
    errors.push('Rendered message has no subject.');
  }

  if (!message?.bodyText?.trim()) {
    errors.push('Rendered message has no text body.');
  }

  if (!message?.to || !message.to.includes('@')) {
    errors.push('Rendered message has no valid recipient.');
  }

  if (message?.from !== config.fromAddress) {
    errors.push('Rendered message from address does not match the configured outreach sender.');
  }

  if (config.senderLegalName && !message?.bodyText?.includes(config.senderLegalName)) {
    errors.push('Rendered message is missing the sender legal name.');
  }

  if (config.physicalMailingAddress && !message?.bodyText?.includes(config.physicalMailingAddress)) {
    errors.push('Rendered message is missing the physical mailing address.');
  }

  if (config.unsubscribeMailto && !message?.bodyText?.includes(config.unsubscribeMailto)) {
    errors.push('Rendered message is missing the opt-out mailbox.');
  }

  if (/\{\{[^}]+\}\}/.test(message?.bodyText ?? '')) {
    errors.push('Rendered message still contains unresolved template placeholders.');
  }

  // Last checkpoint before the bytes reach SES. An invitation whose claim link was
  // reshaped, truncated, or stripped of its fragment looks perfectly fine to the reader
  // and cannot be claimed, so the failure has to be caught here rather than by the host.
  if (message?.requiresCta || message?.ctaUrl) {
    const ctaResult = validateCtaUrl(message?.ctaUrl, config.allowedCtaOrigins);
    errors.push(...ctaResult.errors);

    if (ctaResult.ok) {
      if (!message.bodyText?.includes(message.ctaUrl)) {
        errors.push('The claim link is missing from the text body.');
      }

      if (message.bodyHtml && !message.bodyHtml.includes(message.ctaUrl)) {
        errors.push('The claim link is missing from the HTML body, or was rewritten.');
      }

      if (message.ctaExpiresAt && Date.parse(message.ctaExpiresAt) <= Date.now()) {
        errors.push('The Host prospect behind this claim link has expired; issue a new prospect.');
      }
    }
  }

  const expectedHash = hashBody(message?.to, message?.subject, message?.bodyText, message?.bodyHtml);
  if (message?.bodyHash && message.bodyHash !== expectedHash) {
    errors.push('Rendered message content does not match its body hash.');
  }

  return { ok: errors.length === 0, errors, bodyHash: expectedHash };
}
