import { Storage } from '@google-cloud/storage';
import { RewriteFrames } from '@sentry/integrations';
import * as Sentry from '@sentry/node';
import { readFileSync } from 'fs';
import { basename } from 'path';
import sharp = require('sharp');

/**
 * Exit constants
 */
export const EXIT_SUCCESS = 0;
export const EXIT_TEMPORARY = 1 << 0;
export const EXIT_CONTENT_TYPE = 1 << 1;
export const EXIT_METADATA_ERROR = 1 << 2;
export const EXIT_DOWNLOAD_ERROR = 1 << 3;
export const EXIT_ALREADY_SHARPED = 1 << 4;
export const EXIT_UPLOAD_ERROR = 1 << 5;

/**
 * Configuration
 */
const config = {
  mimes: [
    'image/bmp',
    'image/jpeg',
    'image/tiff',
    'image/png',
  ],
  bucketTempDir: 'tmp-sharp',
  blacklist: [
    'tmp-sharp',
    'tests',
  ],
};

if (process.env.SENTRY_DSN) {
  /**
   * Initialize Sentry
   * Provide root file integration global variable
   * @link https://docs.sentry.io/platforms/node/typescript/
   */
  Sentry.init({
    release: process.env.RELEASE,
    dsn: process.env.SENTRY_DSN,
    integrations: [new RewriteFrames({
      root: __dirname || process.cwd(),
    })],
  });

  Sentry.configureScope((scope: Sentry.Scope) => {
    scope.setTag('bucket', process.env.BUCKET);
  });
}

const sharpFunction = async (data): Promise<number> => {
  const bucketFinalPath = data.id
    .replace(`${data.bucket}/`, '')
    .replace(/\/[0-9]+$/, '')
    .trim();

  const blacklistRegex = new RegExp('/' + config.blacklist.join('|') + '/');

  if (data.id.match(blacklistRegex)) {
    console.log(`Event ${data.id} is a temporary file, ignoring.`);
    return EXIT_TEMPORARY;
  } else if (!config.mimes.includes(data.contentType)) {
    console.log(`Event ${data.id} has ${data.contentType} content-type, ignoring.`);
    return EXIT_CONTENT_TYPE;
  }

  // Initialize variables
  const storage = new Storage();
  const bucket = storage.bucket(data.bucket);
  const bucketTempPath = `${config.bucketTempDir}/${bucketFinalPath}`;
  const systemTempPath = `/tmp/${basename(bucketFinalPath)}`;

  // Retrieve file
  const file = bucket.file(bucketFinalPath);

  // Assert not sharped
  let metadata;

  try {
    [metadata] = await file.getMetadata();

    if (metadata?.metadata) {
      console.log('Received metadata: ' + JSON.stringify(metadata.metadata));
    }
  } catch (e) {
    console.log(`Error while retrieving metadata of ${bucketFinalPath}, ignoring.`);
    return EXIT_METADATA_ERROR;
  }

  if (metadata?.metadata?.sharped) {
    console.log(`File ${bucketFinalPath} has already been sharped, ignoring.`);
    return EXIT_ALREADY_SHARPED;
  }

  // Download file
  try {
    await bucket.file(bucketFinalPath).download({
      destination: systemTempPath,
      validation: false,
    });
  } catch (e) {
    console.log(`Error while downloading ${bucketFinalPath}, ignoring.`);
    return EXIT_DOWNLOAD_ERROR;
  }

  console.log(`Downloaded ${bucketFinalPath} to ${systemTempPath}`);

  // Optimize it
  await sharp(readFileSync(systemTempPath))
    .withMetadata()
    .toFile(systemTempPath);
  console.log(`Sharped ${systemTempPath}`);

  // Upload file to temporary destination
  try {
    await bucket.upload(systemTempPath, {
      destination: bucketTempPath,
      gzip: true,
      resumable: false,
      validation: false,
    });
  } catch (e) {
    console.log(`Error while uploading ${bucketFinalPath}, ignoring.`);
    return EXIT_UPLOAD_ERROR;
  }
  console.log(`Uploaded ${systemTempPath} to ${bucketTempPath}`);

  // Set sharped metadata
  await bucket.file(bucketTempPath).setMetadata({ metadata: { sharped: true } });
  console.log(`Added metadata to ${bucketTempPath}`);

  // Move file to its final destination
  await bucket.file(bucketTempPath).move(bucketFinalPath);
  console.log(`Moved ${bucketTempPath} to ${bucketFinalPath}`);
  return EXIT_SUCCESS;
};

exports['sharp-function'] = async (data): Promise<number> => {
  try {
    return await sharpFunction(data);
  } catch (error) {
    Sentry.captureException(error);
    await Sentry.flush(2000);
    throw error; // Rethrow error
  }
};
