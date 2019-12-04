import * as index from '../src';
import { EXIT_ALREADY_SHARPED, EXIT_CONTENT_TYPE, EXIT_TEMPORARY } from '../src';

const testBed = index['sharp-function'];
const storageMock: any = {};

jest.mock('@google-cloud/storage', () => {
  return {
    Storage: jest.fn(() => storageMock),
  };
});

describe('index.ts', () => {
  it('should return on temporary file', async () => {
    const payload = {
      id: 'bucket/tmp-sharp/file.txt/123456',
      bucket: 'bucket',
    };

    expect(await testBed(payload)).toBe(EXIT_TEMPORARY);
  });

  it('should return on non-image mime', async () => {
    const payload = {
      id: 'bucket/file.txt/123456',
      bucket: 'bucket',
      contentType: 'plain/text',
    };

    expect(await testBed(payload)).toBe(EXIT_CONTENT_TYPE);
  });

  it('should return on positive sharped metadata', async () => {
    const getMetadataMock = jest.fn(() => [
      { metadata: { sharped: true } },
    ]);
    const fileMock = jest.fn(() => {
      return { getMetadata: getMetadataMock };
    });
    storageMock.bucket = jest.fn(() => {
      return { file: fileMock };
    });


    const payload = {
      id: 'bucket/image.png/123456',
      contentType: 'image/png',
    };

    expect(await testBed(payload)).toBe(EXIT_ALREADY_SHARPED);
  });
});
