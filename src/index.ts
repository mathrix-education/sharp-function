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
export const EXIT_FILE_ERROR = 1 << 2;
export const EXIT_ALREADY_SHARPED = 1 << 3;
export const EXIT_DOWNLOAD_ERROR = 1 << 4;

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
  if (data.id.includes(`/${config.bucketTempDir}/`)) {
    console.log(`Event ${data.id} is a temporary file, ignoring.`);
    return EXIT_TEMPORARY;
  } else if (!config.mimes.includes(data.contentType)) {
    console.log(`Event ${data.id} has ${data.contentType} content-type, ignoring.`);
    return EXIT_CONTENT_TYPE;
  }

  // Initialize variables
  const storage = new Storage();
  const bucket = storage.bucket(data.bucket);
  const bucketFinalPath = data.id
    .replace(`${bucket.name}/`, '')
    .replace(/\/[0-9]+$/, '')
    .trim();
  const bucketTempPath = `${config.bucketTempDir}/${bucketFinalPath}`;
  const systemTempPath = `/tmp/${basename(bucketFinalPath)}`;

  // Retrieve file
  let file;
  try {
    file = bucket.file(bucketFinalPath);
  } catch (e) {
    console.log(`Error while retrieving ${bucketFinalPath}, ignoring.`);
    return EXIT_FILE_ERROR;
  }

  // Assert not sharped
  const [metadata] = await file.getMetadata();

  if (metadata?.metadata?.sharped) {
    console.log(`File ${bucketFinalPath} has already been sharped, ignoring.`);
    return EXIT_ALREADY_SHARPED;
  }

  // Download file
  try {
    await bucket.file(bucketFinalPath).download({ destination: systemTempPath });
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
  await bucket.upload(systemTempPath, {
    destination: bucketTempPath,
    gzip: true,
  });
  console.log(`Uploaded ${systemTempPath} to ${bucketTempPath}`);

  // Set sharped metadata
  await bucket.file(bucketTempPath).setMetadata({ sharped: true });
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
