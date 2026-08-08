import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * Errors where retrying cannot help. Anything else (throttling, transient network
 * failure) stays pending so the drain loop can pick it up again.
 */
const TERMINAL_ERROR_NAMES = new Set([
  'AccessDeniedException',
  'BadRequestException',
  'MessageRejected',
  'NotFoundException',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
]);

export function isTerminalProviderError(error) {
  return TERMINAL_ERROR_NAMES.has(error?.name ?? '');
}

let cachedClient = null;
let cachedClientKey = '';

function getClient(config) {
  const key = [config.region, config.accessKeyId].join('|');

  if (cachedClient && cachedClientKey === key) {
    return cachedClient;
  }

  cachedClient = new SESv2Client({
    region: config.region,
    // Falling through to the default provider chain when no explicit pair is set lets
    // an AWS profile or instance role supply credentials without hardcoding them.
    ...(config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  });
  cachedClientKey = key;

  return cachedClient;
}

export async function sendViaSes(config, record) {
  if (config.mode !== 'live') {
    throw new Error(`sendViaSes called while mode is ${config.mode}`);
  }

  if (!config.configurationSet) {
    throw new Error('OUTREACH_SES_CONFIGURATION_SET is required so outreach reputation stays isolated.');
  }

  const headers = (record.headers ?? [])
    .filter((header) => header?.name && header?.value)
    .map((header) => ({ Name: header.name, Value: header.value }));

  const response = await getClient(config).send(
    new SendEmailCommand({
      FromEmailAddress: record.fromDisplay || record.from,
      ReplyToAddresses: record.replyTo ? [record.replyTo] : undefined,
      ConfigurationSetName: config.configurationSet,
      Destination: { ToAddresses: [record.to] },
      Content: {
        Simple: {
          Subject: { Data: record.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: record.bodyText, Charset: 'UTF-8' },
            ...(record.bodyHtml ? { Html: { Data: record.bodyHtml, Charset: 'UTF-8' } } : {}),
          },
          ...(headers.length > 0 ? { Headers: headers } : {}),
        },
      },
    }),
  );

  return { provider: 'ses', providerMessageId: response.MessageId ?? null };
}
