import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessContactPageAttribution,
  assessCreatorDescriptionEmailAttribution,
  assessCreatorSuggestionAttribution,
  assessEmailAttribution,
  assessFeedEmailAttribution,
  assessOrcidEmailAttribution,
  assessPageIdentity,
  assessSocialAttribution,
  extractExplicitPublicEmailCandidates,
  inferAssociatedPersonLabel,
  isPublicResearcherUrl,
  isSocialAccountProfileUrl,
} from './candidate-attribution.mjs';

const candidateName = 'Jelena Obradovic';
const directPage = assessPageIdentity({
  candidateName,
  pageTitle: "Jelena Obradović's Profile | Stanford Profiles",
  pageHeading: 'Jelena Obradović',
  metaDescription: 'Jelena Obradović is part of Stanford Profiles.',
  sourceUrl: 'https://profiles.stanford.edu/jelena-obradovic',
  finalUrl: 'https://profiles.stanford.edu/jelena-obradovic',
});

test('recognizes a candidate-specific official profile', () => {
  assert.equal(directPage.level, 'direct');
  assert.equal(directPage.score, 100);
});

test('keeps public researcher profile URLs', () => {
  assert.equal(
    isPublicResearcherUrl('https://profiles.stanford.edu/jelena-obradovic'),
    true,
  );
});

test('rejects researcher URLs that target a non-public environment', () => {
  assert.equal(
    isPublicResearcherUrl(
      'https://kings-qa.qa.elsevierpure.com/en/persons/2d547ec8-0ea0-4dd7-991e-2da07f1cd934',
    ),
    false,
  );
  assert.equal(isPublicResearcherUrl('https://staging.example.org/researchers/person'), false);
});

test('rejects an institution directory page without candidate identity', () => {
  const result = assessPageIdentity({
    candidateName,
    pageTitle: 'Browse Office of External Relations | Stanford Profiles',
    sourceUrl: 'https://profiles.stanford.edu/browse/office-of-external-relations',
    finalUrl: 'https://profiles.stanford.edu/browse/office-of-external-relations',
  });
  assert.equal(result.level, 'mismatch');
  assert.equal(result.eligible, false);
});

test('keeps a direct email whose local part matches the candidate', () => {
  const result = assessEmailAttribution({
    candidateName,
    email: 'jelena.obradovic@stanford.edu',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.role, 'direct-person');
});

test('keeps a verified ORCID surname email when the public ORCID name uses the first initial', () => {
  const result = assessOrcidEmailAttribution({
    candidateName: 'Marc Lipsitch',
    orcidName: 'Lipsitch M',
    identityConfidence: 'medium',
    email: 'lipsitch@stanford.edu',
    orcidVerified: true,
  });

  assert.equal(result.eligibleForReview, true);
  assert.equal(result.identityAttribution, 'direct');
});

test('quarantines an abbreviated ORCID email local part without a candidate-name match', () => {
  const result = assessOrcidEmailAttribution({
    candidateName: 'Antonia Trichopoulou',
    orcidName: 'ANTONIA TRICHOPOULOU',
    identityConfidence: 'high',
    email: 'atricho@academyhealth.gr',
    orcidVerified: true,
  });

  assert.equal(result.eligibleForReview, false);
});

test('keeps explicitly labeled administrative support on a direct profile', () => {
  const contextText = 'Contact Admin. Support Leslie Dinan ldinan@stanford.edu';
  const result = assessEmailAttribution({
    candidateName,
    email: 'ldinan@stanford.edu',
    contextText,
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.role, 'support-staff');
  assert.equal(inferAssociatedPersonLabel(contextText, 'ldinan@stanford.edu', result.role), 'Leslie Dinan');
});

test('quarantines another employee email even when it is on the same institution domain', () => {
  const directoryPage = assessPageIdentity({
    candidateName,
    pageTitle: 'Browse Office of External Relations | Stanford Profiles',
    finalUrl: 'https://profiles.stanford.edu/browse/office-of-external-relations',
  });
  const result = assessEmailAttribution({
    candidateName,
    email: 'cadami@stanford.edu',
    pageIdentity: directoryPage,
  });
  assert.equal(result.eligibleForReview, false);
});

test('quarantines a generic institutional footer email without representative context', () => {
  const result = assessEmailAttribution({
    candidateName,
    email: 'contact-biox@stanford.edu',
    role: 'generic-office',
    linkText: 'Contact Bio-X',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, false);
});

test('keeps a contact address on the candidate-named domain of a direct page', () => {
  const page = assessPageIdentity({
    candidateName: 'Paul Newham',
    pageTitle: 'Paul Newham',
    sourceUrl: 'https://paulnewham.com/',
    finalUrl: 'https://paulnewham.com/',
  });
  const result = assessEmailAttribution({
    candidateName: 'Paul Newham',
    email: 'voice@paulnewham.com',
    pageIdentity: page,
  });

  assert.equal(result.eligibleForReview, true);
  assert.equal(result.role, 'candidate-owned-contact');
  assert.equal(result.identityAttribution, 'representative');
});

test('quarantines operational mailboxes even on a candidate-named domain', () => {
  const page = assessPageIdentity({
    candidateName: 'Brian Tracy',
    pageTitle: 'Contact Brian Tracy',
    sourceUrl: 'https://briantracy.com/contact',
    finalUrl: 'https://briantracy.com/contact',
  });
  const result = assessEmailAttribution({
    candidateName: 'Brian Tracy',
    email: 'support@briantracy.com',
    pageIdentity: page,
  });

  assert.equal(result.eligibleForReview, false);
  assert.ok(result.identityEvidence.includes('operational-mailbox-is-not-a-candidate-contact-route'));
});

test('quarantines site-wide share and follow social links', () => {
  const result = assessSocialAttribution({
    candidateName,
    url: 'https://www.linkedin.com/school/stanford-university/',
    label: 'Find us on LinkedIn',
    sourceUrl: 'https://profiles.stanford.edu/jelena-obradovic',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, false);
});

test('keeps a social target that names the candidate', () => {
  const result = assessSocialAttribution({
    candidateName,
    url: 'https://www.youtube.com/@JelenaObradovic',
    label: 'YouTube',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.identityAttribution, 'direct');
});

test('does not turn bio, profile, or directory navigation into contact routes', () => {
  const result = assessContactPageAttribution({
    candidateName,
    url: 'https://profiles.stanford.edu/browse/office-of-external-relations',
    label: 'Office of External Relations',
    reason: 'office',
    sourceUrl: 'https://profiles.stanford.edu/jelena-obradovic',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, false);
});

test('keeps an explicitly candidate-named booking route', () => {
  const result = assessContactPageAttribution({
    candidateName,
    url: 'https://example.com/jelena-obradovic/booking',
    label: 'Book Jelena Obradovic',
    reason: 'booking',
    pageIdentity: directPage,
  });
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.identityAttribution, 'direct');
});

test('quarantines generic third-party service links from a candidate-owned page', () => {
  const result = assessContactPageAttribution({
    candidateName: 'Joe Kort',
    url: 'https://www.constantcontact.com/legal/service-provider',
    label: 'Emails are serviced by Constant Contact',
    reason: 'contact',
    sourceUrl: 'https://joekort.com/',
    pageIdentity: {
      level: 'direct',
      score: 95,
      evidence: ['candidate-name-in-title'],
      eligible: true,
    },
  });

  assert.equal(result.eligibleForReview, false);
  assert.equal(result.identityAttribution, 'unresolved');
  assert.ok(result.identityEvidence.includes('external-service-route-lacks-candidate-or-representative-identity'));
});

test('keeps an unnamed social target as associated rather than direct', () => {
  const result = assessSocialAttribution({
    candidateName: 'Shanna Swan',
    url: 'https://www.instagram.com/action_science_initiative/',
    label: 'Instagram',
    sourceUrl: 'https://www.shannaswan.com/',
    pageIdentity: assessPageIdentity({
      candidateName: 'Shanna Swan',
      pageTitle: 'Dr. Shanna Swan',
      sourceUrl: 'https://www.shannaswan.com/',
      finalUrl: 'https://www.shannaswan.com/',
    }),
  });

  assert.equal(result.eligibleForReview, true);
  assert.equal(result.role, 'representative-social');
  assert.equal(result.identityAttribution, 'representative');
});

test('quarantines media schedules and public-speaking articles', () => {
  const mediaSchedule = assessContactPageAttribution({
    candidateName: 'Mai Shiraishi',
    url: 'https://maishiraishi-official.com/s/ms/media/detail/11700?year=2026',
    label: 'TV 20:00-21:00',
    reason: 'media',
    sourceUrl: 'https://maishiraishi-official.com/',
    pageIdentity: directPage,
  });
  const speakingArticle = assessContactPageAttribution({
    candidateName: 'Brian Tracy',
    url: 'https://briantracy.com/blog/public-speaking/how-to-start-a-speech',
    label: 'How to start a speech',
    reason: 'speaking',
    sourceUrl: 'https://briantracy.com/',
    pageIdentity: directPage,
  });
  const hiringArticle = assessContactPageAttribution({
    candidateName: 'Shama Hyder',
    url: 'https://shamahyder.com/how-to-hire-a-keynote-speaker/',
    label: 'How to hire a speaker',
    reason: 'speaker',
    pageIdentity: directPage,
  });
  assert.equal(mediaSchedule.eligibleForReview, false);
  assert.equal(speakingArticle.eligibleForReview, false);
  assert.equal(hiringArticle.eligibleForReview, false);
});

test('keeps route-shaped speaker and press pages', () => {
  const speakerPage = assessContactPageAttribution({
    candidateName: 'Brian Tracy',
    url: 'https://briantracy.com/speaker/',
    label: 'Book Brian Tracy',
    reason: 'speaker',
    sourceUrl: 'https://briantracy.com/',
    pageIdentity: directPage,
  });
  assert.equal(speakerPage.eligibleForReview, true);
});

test('quarantines contact descendants, feeds, and static assets', () => {
  const contactNews = assessContactPageAttribution({
    candidateName,
    url: 'https://jelenaobradovic.com/contact/updates/news/',
    label: 'News',
    reason: 'contact',
    pageIdentity: directPage,
  });
  const asset = assessContactPageAttribution({
    candidateName,
    url: 'https://jelenaobradovic.com/speaking/assets/site.css',
    label: 'stylesheet',
    reason: 'speaking',
    pageIdentity: directPage,
  });
  const repositoryFile = assessContactPageAttribution({
    candidateName: 'Chris von Csefalvay',
    url: 'https://github.com/chrisvoncsefalvay/chrisvoncsefalvay/blob/main/media',
    label: 'featured in the media',
    reason: 'media',
    sourceUrl: 'https://github.com/chrisvoncsefalvay',
    pageIdentity: assessPageIdentity({
      candidateName: 'Chris von Csefalvay',
      pageTitle: 'chrisvoncsefalvay (Chris von Csefalvay) · GitHub',
      sourceUrl: 'https://github.com/chrisvoncsefalvay',
      finalUrl: 'https://github.com/chrisvoncsefalvay',
    }),
  });
  assert.equal(contactNews.eligibleForReview, false);
  assert.equal(asset.eligibleForReview, false);
  assert.equal(repositoryFile.eligibleForReview, false);
});

test('quarantines social share actions and embedded content', () => {
  const share = assessSocialAttribution({
    candidateName,
    url: 'https://www.linkedin.com/shareArticle?url=https://example.com/jelena-obradovic',
    label: 'Share on LinkedIn',
    pageIdentity: directPage,
  });
  const embeddedPost = assessSocialAttribution({
    candidateName,
    url: 'https://www.instagram.com/p/example/',
    label: 'A post shared by someone else',
    sourceUrl: 'https://jelenaobradovic.com/',
    pageIdentity: directPage,
  });
  assert.equal(share.eligibleForReview, false);
  assert.equal(embeddedPost.eligibleForReview, false);
  assert.equal(isSocialAccountProfileUrl('https://facebook.com/share/example'), false);
  assert.equal(isSocialAccountProfileUrl('https://youtube.com/channel/official'), true);
});

test('quarantines third-party profiles linked from an embedded social stream', () => {
  const pageIdentity = assessPageIdentity({
    candidateName: 'Steven Pinker',
    pageTitle: 'Steven Pinker',
    sourceUrl: 'https://stevenpinker.com/',
    finalUrl: 'https://stevenpinker.com/',
  });
  const result = assessSocialAttribution({
    candidateName: 'Steven Pinker',
    url: 'https://twitter.com/Briankeating',
    label: '@Briankeating',
    contextText: 'sapinker RT @Briankeating: Bucket list conversation. View post /sapinker/status/123',
    sourceUrl: 'https://stevenpinker.com/',
    pageIdentity,
  });

  assert.equal(result.eligibleForReview, false);
  assert.equal(result.role, 'social-content');
  assert.ok(result.identityEvidence.includes('embedded-social-stream-target-does-not-name-candidate'));
});

test('rejects social platform privacy and policy routes as account profiles', () => {
  assert.equal(isSocialAccountProfileUrl('https://www.facebook.com/privacy/explanation'), false);
  assert.equal(isSocialAccountProfileUrl('https://twitter.com/privacy'), false);
  assert.equal(isSocialAccountProfileUrl('https://www.instagram.com/legal/privacy/'), false);
  assert.equal(isSocialAccountProfileUrl('https://www.facebook.com/Baradari2023/'), true);
  assert.equal(
    isSocialAccountProfileUrl('https://www.facebook.com/Stevenpinkerpage/videos/example-video/123456/'),
    false,
  );
  assert.equal(isSocialAccountProfileUrl('https://www.facebook.com/reel/123456'), false);
  assert.equal(isSocialAccountProfileUrl('https://www.facebook.com/photo.php?id=123456'), false);
  assert.equal(isSocialAccountProfileUrl('https://x.com/NBaradari'), true);
});

test('rejects automated feed mailboxes and keeps candidate-owned feed email', () => {
  const automated = assessFeedEmailAttribution({
    candidateName: 'John Michael Greer',
    email: 'noreply@blogger.com',
    feedUrl: 'https://example.blogspot.com/feeds/posts/default',
  });
  const direct = assessFeedEmailAttribution({
    candidateName: 'Martin Fowler',
    email: 'martin@martinfowler.com',
    feedUrl: 'https://martinfowler.com/feed.atom',
    siteUrl: 'https://martinfowler.com/',
  });
  assert.equal(automated.eligibleForReview, false);
  assert.equal(direct.eligibleForReview, true);
  assert.equal(direct.role, 'direct-person');
});

test('keeps known creator URLs and quarantines medium-confidence search guesses', () => {
  const known = assessCreatorSuggestionAttribution({
    url: 'https://www.youtube.com/channel/official',
    confidence: 'low',
    knownSourceUrls: ['https://youtube.com/channel/official'],
  });
  const searchGuess = assessCreatorSuggestionAttribution({
    url: 'https://www.youtube.com/channel/same-name-fan',
    confidence: 'medium',
    knownSourceUrls: ['https://youtube.com/channel/official'],
  });
  assert.equal(known.eligibleForReview, true);
  assert.equal(searchGuess.eligibleForReview, false);
});

test('quarantines non-owned creator channels even when their URL is known', () => {
  const topicChannel = assessCreatorSuggestionAttribution({
    url: 'https://www.youtube.com/channel/topic',
    label: 'David Gilmour - Topic',
    confidence: 'high',
    knownSourceUrls: ['https://youtube.com/channel/topic'],
  });
  const fanChannel = assessCreatorSuggestionAttribution({
    url: 'https://www.youtube.com/channel/fan',
    label: 'NScherzingerFan',
    evidence: ['Dedicated to videos of Nicole Scherzinger'],
    confidence: 'high',
  });

  assert.equal(topicChannel.eligibleForReview, false);
  assert.equal(fanChannel.eligibleForReview, false);
});

test('keeps an explicit collaboration email from a direct creator channel description', () => {
  const [email] = extractExplicitPublicEmailCandidates(
    '¿Te interesa colaborar? Escríbeme: hola@noemicasquet.com',
  );
  const result = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Noemí Casquet',
    email: email.value,
    contextText: email.contextText,
    channelAssessment: {
      eligibleForReview: true,
      identityAttribution: 'direct',
      identityConfidence: 'high',
      identityScore: 85,
      identityEvidence: ['creator-discovery-has-high-name-and-topic-confidence'],
    },
  });

  assert.equal(result.eligibleForReview, true);
  assert.equal(result.identityAttribution, 'representative');
  assert.ok(result.identityEvidence.includes('explicit-creator-contact-intent'));
});

test('quarantines description emails when the creator channel is not directly attributed', () => {
  const [email] = extractExplicitPublicEmailCandidates(
    'Business inquiries: bookings@example.com',
  );
  const result = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Example Person',
    email: email.value,
    contextText: email.contextText,
    channelAssessment: {
      eligibleForReview: false,
      identityAttribution: 'unresolved',
      identityConfidence: 'low',
      identityScore: 0,
    },
  });

  assert.equal(result.eligibleForReview, false);
  assert.ok(result.identityEvidence.includes('creator-channel-is-not-high-confidence-direct'));
});

test('does not borrow contact intent across a blank line for a merchandise mailbox', () => {
  const emails = extractExplicitPublicEmailCandidates(
    'CONTRATACIONES: creator@example.com\n\nPide tus productos a: merchandise@example.com',
  );
  const channelAssessment = {
    eligibleForReview: true,
    identityAttribution: 'direct',
    identityConfidence: 'high',
    identityScore: 90,
  };
  const business = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Example Creator',
    email: emails[0].value,
    contextText: emails[0].intentContextText,
    channelAssessment,
  });
  const merchandise = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Example Creator',
    email: emails[1].value,
    contextText: emails[1].intentContextText,
    channelAssessment,
  });

  assert.equal(business.eligibleForReview, true);
  assert.equal(merchandise.eligibleForReview, false);
  assert.ok(merchandise.identityEvidence.includes('creator-email-lacks-explicit-professional-contact-intent'));
});

test('does not treat a contact mailbox local part as professional intent by itself', () => {
  const [email] = extractExplicitPublicEmailCandidates(
    'Impressum\nExample Agency GmbH\nE-Mail: kontakt@example.com',
  );
  const result = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Example Creator',
    email: email.value,
    contextText: email.intentContextText,
    channelAssessment: {
      eligibleForReview: true,
      identityAttribution: 'direct',
      identityConfidence: 'high',
      identityScore: 90,
    },
  });

  assert.equal(result.eligibleForReview, false);
});

test('keeps professional intent separated from the email by a blank line', () => {
  const [email] = extractExplicitPublicEmailCandidates(
    'Für geschäftliche Anfragen:\n\ncontact@creator.example',
  );
  const result = assessCreatorDescriptionEmailAttribution({
    candidateName: 'Example Creator',
    email: email.value,
    contextText: email.intentContextText,
    channelAssessment: {
      eligibleForReview: true,
      identityAttribution: 'direct',
      identityConfidence: 'high',
      identityScore: 90,
    },
  });

  assert.equal(result.eligibleForReview, true);
});
