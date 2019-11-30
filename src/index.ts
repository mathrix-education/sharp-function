import { Storage } from '@google-cloud/storage';
import { readFileSync } from 'fs';
import { basename } from 'path';
import sharp = require('sharp');

const mimes = [
  'image/bmp',
  'image/jpeg',
  'image/tiff',
  'image/png',
];

exports['sharp-function'] = async (data, context) => {
  if (data.id.includes('/tmp/')) {
    console.log(`Event ${data.id} is a temporary file, ignoring`);
  } else if (!mimes.includes(data.contentType)) {
    console.log(`Event ${data.id} has ${data.contentType} content-type, ignoring.`);
    return;
  }

  // Initialize variables
  const storage = new Storage();
  const bucket = storage.bucket(data.bucket);
  const bucketFinalPath = data.id
    .replace(`${bucket.name}/`, '')
    .replace(/\/[0-9]+/, '')
    .trim();
  const bucketTempPath = `tmp/${bucketFinalPath}`;
  const systemTempPath = `tmp/${basename(bucketFinalPath)}`;

  const file = bucket.file(bucketFinalPath);

  // Assert not sharped
  const metadata = (await file.getMetadata())[0].metadata;
  if (metadata.sharped) {
    console.log(`File ${bucketFinalPath} has already been sharped`);
    return;
  }

  // Download file
  await bucket.file(bucketFinalPath).download({ destination: systemTempPath });

  // Optimize it
  await sharp(readFileSync(systemTempPath))
    .withMetadata()
    .toFile(systemTempPath);

  // Upload file to temporary destination
  await bucket.upload(systemTempPath, {
    destination: bucketTempPath,
    gzip: true,
  });

  // Set sharped metadata
  await bucket.file(bucketTempPath).setMetadata({ sharped: true });

  // Move file to its final destination
  await bucket.file(bucketTempPath).move(bucketFinalPath);
};
