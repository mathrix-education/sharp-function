import { Storage } from '@google-cloud/storage';
import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import sharp = require('sharp');

const mimes = [
  'image/bmp',
  'image/jpeg',
  'image/tiff',
  'image/png',
];

exports['sharp-function'] = async (data, context) => {
  if (!mimes.includes(data.contentType)) {
    console.log(`Event ${data.id} has ${data.contentType} content-type, ignoring.`);
    return;
  }

  // Initialize variables
  const storage = new Storage();
  const bucket = storage.bucket(data.bucket);
  const bucketFilePath = 'gs://' + data.id.replace(/\/[0-9]+/, '');
  const bucketFlagPath = `${bucketFilePath}.flag`;
  const tempFilePath = resolve('/tmp', basename(bucketFilePath));
  const tempFlagPath = `${tempFilePath}.flag`;

  if (bucket.file(bucketFlagPath).exists()) {
    console.log('Found flag, deleting.');
    return await bucket.file(bucketFlagPath).delete();
  }

  // Download file
  await bucket.file(bucketFilePath).download({ destination: tempFilePath });

  // Optimize it
  await sharp(readFileSync(tempFilePath))
    .withMetadata()
    .toFile(tempFilePath);

  // Write flag and upload it
  writeFileSync(tempFlagPath, 'flag');
  await bucket.upload(tempFlagPath, {
    destination: bucketFlagPath,
    gzip: true,
  });

  // Upload file
  await bucket.upload(tempFilePath, {
    destination: bucketFilePath,
    gzip: true,
  });
};
