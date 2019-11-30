const {Storage} = require('@google-cloud/storage');

const lol = async () => {
  const client = new Storage();
  const file = await client.bucket('dev.cdn.mathrixdrive.fr').file('test2.jpg');
  await file.setMetadata({
    metadata: {
      sharped: true
    }
  });

  console.log((await file.getMetadata())[0].metadata);
};

lol().then(() => console.log('Done'));
