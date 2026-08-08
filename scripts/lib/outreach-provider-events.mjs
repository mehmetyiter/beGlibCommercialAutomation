import { addSuppression } from './outreach-suppression.mjs';
import { isoNow, normalizeEmail, readState, updateState } from './outreach-store.mjs';

const EMPTY_STATE = { version: 1, processedEventKeys: [], counters: {}, lastPolledAt: null, updatedAt: null };

/**
 * SES publishes to SNS, which we forward to SQS and poll locally. That keeps the whole
 * feedback loop inside the trusted local process: no public webhook has to be exposed
 * just to learn that an address hard-bounced.
 */
/**
 * Classifies a queue message.
 *
 * `kind` drives whether the caller may delete the message:
 *   - `event`     an SES notification to apply, then delete
 *   - `notice`    valid SNS traffic that carries no event, such as the plain-text
 *                 "Successfully validated SNS topic" message SES publishes when an event
 *                 destination is created. Safe to delete; keeping it would recycle it forever.
 *   - `malformed` unrecognised. Left on the queue to expire under the retention policy
 *                 rather than silently discarded, so a genuine parser gap stays visible.
 */
export function parseProviderEvent(rawBody) {
  let envelope;

  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return { ok: false, kind: 'malformed', error: 'Queue message body is not valid JSON.' };
  }

  // SNS wraps the SES event in a `Message` string; a raw-delivery queue skips the wrapper.
  let payload = envelope;
  if (typeof envelope?.Message === 'string') {
    try {
      payload = JSON.parse(envelope.Message);
    } catch {
      return {
        ok: false,
        kind: 'notice',
        error: `SNS notice carried no event payload: ${envelope.Message.slice(0, 120)}`,
      };
    }
  }

  const eventType = payload?.eventType ?? payload?.notificationType;

  if (!eventType) {
    return { ok: false, kind: 'notice', error: 'SNS payload carried no eventType.' };
  }

  const providerMessageId = payload?.mail?.messageId ?? null;
  const recipients = collectRecipients(eventType, payload);

  return {
    ok: true,
    kind: 'event',
    event: {
      eventType,
      providerMessageId,
      recipients,
      subType: payload?.bounce?.bounceType ?? payload?.complaint?.complaintFeedbackType ?? null,
      occurredAt: payload?.mail?.timestamp ?? payload?.bounce?.timestamp ?? payload?.complaint?.timestamp ?? null,
    },
  };
}

function collectRecipients(eventType, payload) {
  const lists = {
    Bounce: payload?.bounce?.bouncedRecipients,
    Complaint: payload?.complaint?.complainedRecipients,
    Delivery: payload?.delivery?.recipients,
    Reject: payload?.mail?.destination,
  };

  const raw = lists[eventType] ?? payload?.mail?.destination ?? [];

  return raw
    .map((entry) => normalizeEmail(typeof entry === 'string' ? entry : entry?.emailAddress))
    .filter(Boolean);
}

/**
 * Only a permanent bounce or a complaint suppresses an address. Transient bounces are
 * counted so a pattern is visible, but a full mailbox is not an opt-out.
 */
export function suppressionReasonForEvent(event) {
  if (event.eventType === 'Complaint') {
    return 'spam-complaint';
  }

  if (event.eventType === 'Bounce' && event.subType === 'Permanent') {
    return 'hard-bounce';
  }

  return null;
}

export function eventKey(event, recipient) {
  return [event.providerMessageId ?? 'no-message-id', event.eventType, event.subType ?? '-', recipient].join('|');
}

export async function loadProviderEventState(config) {
  return readState(config.paths.providerEvents, EMPTY_STATE);
}

/**
 * Applies a batch of parsed events. Every (message, event, recipient) triple is recorded
 * before the queue message is deleted, so re-polling the same event is a no-op.
 */
export async function applyProviderEvents(config, events, { actor = 'ses-event-poller' } = {}) {
  const state = await loadProviderEventState(config);
  const processed = new Set(state.processedEventKeys ?? []);
  const counters = { ...(state.counters ?? {}) };

  const suppressed = [];
  const skipped = [];
  const newKeys = [];

  for (const event of events) {
    for (const recipient of event.recipients) {
      const key = eventKey(event, recipient);

      if (processed.has(key)) {
        skipped.push(key);
        continue;
      }

      processed.add(key);
      newKeys.push(key);
      counters[event.eventType] = (counters[event.eventType] ?? 0) + 1;

      const reason = suppressionReasonForEvent(event);

      if (!reason) {
        continue;
      }

      const result = await addSuppression(config, {
        kind: 'email',
        value: recipient,
        reason,
        source: `ses-${event.eventType.toLowerCase()}`,
        note: `SES ${event.eventType}${event.subType ? ` (${event.subType})` : ''} for provider message ${event.providerMessageId ?? 'unknown'}`,
        addedBy: actor,
      });

      if (result.ok && result.created) {
        suppressed.push({ email: recipient, reason });
      }
    }
  }

  if (newKeys.length > 0) {
    await updateState(config.paths.providerEvents, EMPTY_STATE, (current) => ({
      ...current,
      processedEventKeys: [...new Set([...(current.processedEventKeys ?? []), ...newKeys])],
      counters,
      lastPolledAt: isoNow(),
    }));
  }

  return {
    ok: true,
    applied: newKeys.length,
    skippedDuplicates: skipped.length,
    suppressed,
    counters,
  };
}
