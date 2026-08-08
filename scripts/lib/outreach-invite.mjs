import { readFile } from 'node:fs/promises';

/**
 * Reads the private Host prospect state written by `host-prospect:record-response` and
 * finds the claim link for one candidate.
 *
 * The state file is the only place a CTA token exists locally, and it is deliberately not
 * part of the outreach state set: the invitation send step is the single consumer, and the
 * retention policy strips the token once a record goes terminal or expires.
 */
export async function loadHostProspectState(config) {
  try {
    const parsed = JSON.parse(await readFile(config.paths.hostProspectState, 'utf8'));

    return { ok: true, state: parsed };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: false,
        errors: [
          `No Host prospect state at ${config.paths.hostProspectState}. Issue a prospect with host-prospect:create and record it with host-prospect:record-response first.`,
        ],
      };
    }

    return { ok: false, errors: [`Host prospect state could not be read: ${error.message}`] };
  }
}

/**
 * Returns the one record that may still be invited against. A record qualifies only while
 * it is issued, unexpired, un-redacted, and not terminal — anything else means the
 * candidate has already claimed, been revoked, or run out of time, and re-sending the old
 * link would be wrong rather than merely useless.
 */
export function findInvitableProspect(state, { candidateId, campaignId, now = new Date() } = {}) {
  const records = (state?.records ?? []).filter((record) => record.externalCandidateId === candidateId);

  if (records.length === 0) {
    return { ok: false, errors: [`No Host prospect has been issued for candidate ${candidateId}.`] };
  }

  const scoped = campaignId ? records.filter((record) => record.campaignId === campaignId) : records;

  if (scoped.length === 0) {
    return {
      ok: false,
      errors: [`Host prospects exist for ${candidateId} but none in campaign ${campaignId}.`],
    };
  }

  const reasons = [];

  const usable = scoped.filter((record) => {
    if (record.terminalAt) {
      reasons.push(`${record.prospectId} is terminal (${record.lastAuthoritativeEventType ?? 'unknown'}).`);
      return false;
    }

    if (!record.ctaUrl) {
      reasons.push(
        record.ctaRedactedAt
          ? `${record.prospectId} had its claim link redacted under the retention policy.`
          : `${record.prospectId} carries no claim link.`,
      );
      return false;
    }

    if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) {
      reasons.push(`${record.prospectId} expired on ${record.expiresAt}.`);
      return false;
    }

    return true;
  });

  if (usable.length === 0) {
    return { ok: false, errors: ['No invitable Host prospect for this candidate.', ...reasons] };
  }

  // Newest issued record wins if a prospect was re-issued after a revoke.
  const record = usable.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)))[0];

  return {
    ok: true,
    invite: {
      prospectId: record.prospectId,
      ctaUrl: record.ctaUrl,
      expiresAt: record.expiresAt,
      campaignId: record.campaignId,
      campaignMemberId: record.campaignMemberId,
    },
  };
}

export async function resolveInviteForCandidate(config, { candidateId, campaignId, now } = {}) {
  const loaded = await loadHostProspectState(config);

  if (!loaded.ok) {
    return loaded;
  }

  return findInvitableProspect(loaded.state, { candidateId, campaignId, now });
}
