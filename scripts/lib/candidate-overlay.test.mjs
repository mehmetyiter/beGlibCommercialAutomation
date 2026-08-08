import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  MAX_BULK_REVIEW_CANDIDATES,
  applyOverlay,
  createManualCandidate,
  loadOverlayState,
  recordReviewOutcome,
  recordReviewOutcomes,
  revokeChannelVerification,
  validateChannelVerificationInput,
  validateManualCandidateInput,
  validateReviewOutcomeInput,
  verifyChannel,
} from './candidate-overlay.mjs';

const directories = [];

async function testConfig() {
  const directory = await mkdtemp(join(tmpdir(), 'beglib-overlay-'));
  directories.push(directory);

  return {
    paths: {
      candidateOverlay: join(directory, 'candidate-overlay.local.json'),
      audit: join(directory, 'audit.local.jsonl'),
    },
  };
}

function dossierPackage() {
  return {
    reviewId: 'test-dossiers',
    summary: { candidates: 1 },
    dossiers: [
      {
        candidateId: 'wikidata-Q1',
        name: 'Existing Person',
        category: 'science',
        country: 'Canada',
        status: 'researching',
        consentStatus: 'unknown',
        riskLevel: 'low',
        sensitiveFlags: [],
        discoveryStar: { stars: 3, score: 42, label: 'Promising discovery dossier' },
        counts: { discoveryChannels: 1, quarantinedChannels: 1 },
        discoveryChannels: [
          {
            source: 'youtube-data-api',
            platform: 'youtube',
            label: 'Existing Person',
            url: 'https://www.youtube.com/@existing/',
            verified: false,
            confidence: 'medium',
          },
        ],
        quarantinedChannels: [
          {
            platform: 'x',
            label: 'Maybe them',
            url: 'https://x.com/maybe',
            verified: false,
            confidence: 'low',
          },
        ],
        reviewOutcome: { candidateId: 'wikidata-Q1', outcomeStatus: 'pending', reviewerNotes: '' },
      },
    ],
  };
}

const manualInput = {
  datasetId: 'all-waves-discovery-dossiers',
  name: 'Mayada Elsabbagh',
  title: 'Neuroscience researcher',
  category: 'science',
  country: 'Canada',
  sourceUrl: 'https://example.org/profile',
  note: 'Verified by hand from the lab page.',
  operatorRef: 'reviewer:mehmet',
};

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test('manual candidate input requires a source URL and a named operator', () => {
  assert.equal(validateManualCandidateInput(manualInput).ok, true);

  const missing = validateManualCandidateInput({ ...manualInput, sourceUrl: 'example.org', operatorRef: '' });

  assert.equal(missing.ok, false);
  assert.equal(missing.errors.length, 2);
});

test('review outcome input rejects unknown statuses and out-of-range stars', () => {
  const base = { candidateId: 'wikidata-Q1', datasetId: 'set', outcomeStatus: 'approved', operatorRef: 'reviewer:mehmet' };

  assert.equal(validateReviewOutcomeInput(base).ok, true);
  assert.equal(validateReviewOutcomeInput({ ...base, outcomeStatus: 'maybe' }).ok, false);
  assert.equal(validateReviewOutcomeInput({ ...base, star: 9 }).ok, false);
  assert.equal(validateReviewOutcomeInput({ ...base, star: '' }).ok, true);
  assert.equal(validateReviewOutcomeInput({ ...base, riskLevel: 'severe' }).ok, false);
});

test('a manual candidate is merged into the package it was created against', async () => {
  const config = await testConfig();
  const created = await createManualCandidate(config, manualInput);

  assert.equal(created.ok, true);
  assert.match(created.record.candidateId, /^manual-mayada-elsabbagh-/);

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const merged = applyOverlay(dossierPackage(), state, manualInput.datasetId);

  assert.equal(merged.dossiers.length, 2);
  assert.equal(merged.summary.candidates, 2);
  assert.equal(merged.summary.manualCandidates, 1);

  const manual = merged.dossiers.find((dossier) => dossier.candidateId === created.record.candidateId);

  assert.equal(manual.name, 'Mayada Elsabbagh');
  assert.equal(manual.origin, 'manual-entry');
  assert.deepEqual(manual.sourceUrls, ['https://example.org/profile']);
  assert.equal(manual.contactCandidates.length, 0);

  // Another dataset must not inherit a candidate entered while a different one was open.
  assert.equal(applyOverlay(dossierPackage(), state, 'other-dataset').dossiers.length, 1);
});

test('a review outcome overrides status, consent, risk, and star on the generated dossier', async () => {
  const config = await testConfig();

  const saved = await recordReviewOutcome(config, {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    outcomeStatus: 'approved',
    note: 'Checked the university page by hand.',
    consentStatus: 'public-business-contact',
    riskLevel: 'high',
    star: 5,
    operatorRef: 'reviewer:mehmet',
  });

  assert.equal(saved.ok, true);

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.status, 'approved');
  assert.equal(dossier.consentStatus, 'public-business-contact');
  assert.equal(dossier.riskLevel, 'high');
  assert.deepEqual(dossier.sensitiveFlags, ['high-risk']);
  assert.equal(dossier.discoveryStar.stars, 5);
  assert.equal(dossier.discoveryStar.discoveredStars, 3);
  assert.equal(dossier.reviewOutcome.outcomeStatus, 'approved');
  assert.equal(dossier.reviewOutcome.reviewedBy, 'reviewer:mehmet');
});

test('a rejected review marks the candidate do-not-contact so the send gate blocks it', async () => {
  const config = await testConfig();

  await recordReviewOutcome(config, {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    outcomeStatus: 'rejected',
    note: 'Not a fit.',
    operatorRef: 'reviewer:mehmet',
  });

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.status, 'do-not-contact');
});

test('re-reviewing the same candidate updates one record instead of stacking duplicates', async () => {
  const config = await testConfig();
  const input = {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    outcomeStatus: 'deferred',
    operatorRef: 'reviewer:mehmet',
  };

  await recordReviewOutcome(config, input);
  await recordReviewOutcome(config, { ...input, outcomeStatus: 'approved', note: 'Second pass.' });

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].review.outcomeStatus, 'approved');
  assert.equal(state.records[0].review.note, 'Second pass.');
});

test('reviewing a manually entered candidate keeps both parts on one record', async () => {
  const config = await testConfig();
  const created = await createManualCandidate(config, manualInput);

  await recordReviewOutcome(config, {
    datasetId: manualInput.datasetId,
    candidateId: created.record.candidateId,
    outcomeStatus: 'approved',
    consentStatus: 'public-business-contact',
    operatorRef: 'reviewer:mehmet',
  });

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 1);

  const merged = applyOverlay(dossierPackage(), state, manualInput.datasetId);
  const manual = merged.dossiers.find((dossier) => dossier.candidateId === created.record.candidateId);

  assert.equal(manual.status, 'approved');
  assert.equal(manual.consentStatus, 'public-business-contact');
});

test('a bulk review writes one record per candidate and dedupes repeated ids', async () => {
  const config = await testConfig();

  const result = await recordReviewOutcomes(config, {
    datasetId: 'set',
    candidateIds: ['wikidata-Q1', 'wikidata-Q2', 'wikidata-Q1'],
    outcomeStatus: 'deferred',
    note: 'Wave 2 icin bekletiliyor.',
    operatorRef: 'reviewer:mehmet',
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 2);

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 2);
  assert.equal(state.records[0].review.outcomeStatus, 'deferred');
  assert.equal(state.records[0].review.reviewedBy, 'reviewer:mehmet');

  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.status, 'needs-review');
  assert.equal(dossier.reviewOutcome.reviewerNotes, 'Wave 2 icin bekletiliyor.');
});

test('a bulk review applies the same validation as a single one', async () => {
  const config = await testConfig();
  const base = {
    datasetId: 'set',
    candidateIds: ['wikidata-Q1'],
    outcomeStatus: 'approved',
    operatorRef: 'reviewer:mehmet',
  };

  assert.equal((await recordReviewOutcomes(config, { ...base, candidateIds: [] })).ok, false);
  assert.equal((await recordReviewOutcomes(config, { ...base, outcomeStatus: 'maybe' })).ok, false);
  assert.equal((await recordReviewOutcomes(config, { ...base, operatorRef: '' })).ok, false);
  assert.equal((await recordReviewOutcomes(config, { ...base, star: 0 })).ok, false);

  const overLimit = await recordReviewOutcomes(config, {
    ...base,
    candidateIds: Array.from({ length: MAX_BULK_REVIEW_CANDIDATES + 1 }, (_, index) => `wikidata-Q${index}`),
  });

  assert.equal(overLimit.ok, false);
  assert.match(overLimit.errors[0], /limited to 500/);

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 0);
});

test('a bulk review supersedes an earlier single review on the same candidate', async () => {
  const config = await testConfig();

  await recordReviewOutcome(config, {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    outcomeStatus: 'approved',
    star: 5,
    operatorRef: 'reviewer:mehmet',
  });

  await recordReviewOutcomes(config, {
    datasetId: 'set',
    candidateIds: ['wikidata-Q1'],
    outcomeStatus: 'rejected',
    operatorRef: 'reviewer:mehmet',
  });

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].review.outcomeStatus, 'rejected');
  assert.equal(state.records[0].review.star, null);
});

test('channel verification input requires a URL, an operator, and evidence', () => {
  const base = {
    candidateId: 'wikidata-Q1',
    datasetId: 'set',
    url: 'https://www.youtube.com/@existing',
    operatorRef: 'reviewer:mehmet',
    evidenceNote: 'Linked from the lab page.',
  };

  assert.equal(validateChannelVerificationInput(base).ok, true);
  assert.equal(validateChannelVerificationInput({ ...base, url: 'youtube.com/@existing' }).ok, false);
  assert.equal(validateChannelVerificationInput({ ...base, evidenceNote: '' }).ok, false);
  assert.equal(validateChannelVerificationInput({ ...base, operatorRef: '' }).ok, false);
});

test('verifying a channel marks the discovery channel verified, ignoring trailing-slash differences', async () => {
  const config = await testConfig();

  const result = await verifyChannel(config, {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    // No trailing slash here, one in the dossier: the same channel either way.
    url: 'https://www.youtube.com/@existing',
    platform: 'youtube',
    label: 'Existing Person',
    evidenceNote: 'Channel is linked from her university profile.',
    operatorRef: 'reviewer:mehmet',
  });

  assert.equal(result.ok, true);

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.discoveryChannels.length, 1);
  assert.equal(dossier.discoveryChannels[0].verified, true);
  assert.equal(dossier.discoveryChannels[0].confidence, 'verified');
  assert.equal(dossier.discoveryChannels[0].operatorVerification.verifiedBy, 'reviewer:mehmet');
  assert.equal(dossier.counts.verifiedChannels, 1);
});

test('verifying a quarantined channel promotes it out of quarantine', async () => {
  const config = await testConfig();

  await verifyChannel(config, {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    url: 'https://x.com/maybe',
    platform: 'x',
    label: 'Maybe them',
    evidenceNote: 'She links this account from her own site.',
    operatorRef: 'reviewer:mehmet',
  });

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.quarantinedChannels.length, 0);
  assert.equal(dossier.counts.quarantinedChannels, 0);
  assert.equal(dossier.discoveryChannels.length, 2);
  assert.equal(dossier.discoveryChannels[1].verified, true);
  assert.equal(dossier.discoveryChannels[1].source, 'operator-review');
  assert.equal(dossier.counts.discoveryChannels, 2);
});

test('re-verifying the same channel replaces the entry instead of duplicating it', async () => {
  const config = await testConfig();
  const input = {
    datasetId: 'set',
    candidateId: 'wikidata-Q1',
    url: 'https://www.youtube.com/@existing',
    platform: 'youtube',
    evidenceNote: 'First pass.',
    operatorRef: 'reviewer:mehmet',
  };

  await verifyChannel(config, input);
  await verifyChannel(config, { ...input, evidenceNote: 'Second pass.' });

  const state = await loadOverlayState(config.paths.candidateOverlay);

  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].verifiedChannels.length, 1);
  assert.equal(state.records[0].verifiedChannels[0].evidenceNote, 'Second pass.');
});

test('revoking a channel verification returns the dossier to its generated state', async () => {
  const config = await testConfig();
  const target = { datasetId: 'set', candidateId: 'wikidata-Q1', url: 'https://www.youtube.com/@existing' };

  await verifyChannel(config, {
    ...target,
    platform: 'youtube',
    evidenceNote: 'Linked from her profile.',
    operatorRef: 'reviewer:mehmet',
  });

  const missing = await revokeChannelVerification(config, {
    ...target,
    url: 'https://example.org/not-verified',
    operatorRef: 'reviewer:mehmet',
  });

  assert.equal(missing.ok, false);

  const revoked = await revokeChannelVerification(config, { ...target, operatorRef: 'reviewer:mehmet' });

  assert.equal(revoked.ok, true);

  const state = await loadOverlayState(config.paths.candidateOverlay);
  const [dossier] = applyOverlay(dossierPackage(), state, 'set').dossiers;

  assert.equal(dossier.discoveryChannels[0].verified, false);
  assert.equal(dossier.discoveryChannels[0].operatorVerification, undefined);
});

test('an empty overlay returns the package untouched', async () => {
  const config = await testConfig();
  const state = await loadOverlayState(config.paths.candidateOverlay);
  const original = dossierPackage();

  assert.equal(applyOverlay(original, state, 'set'), original);
});
