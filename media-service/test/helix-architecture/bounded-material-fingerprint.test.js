'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  FINGERPRINT_SAMPLE_BYTES,
  computeBoundedMaterialFingerprint,
  computeBoundedMaterialFingerprintSync,
} = require('../../src/helix/integrations/bounded-material-fingerprint');

function stat(size, overrides = {}) {
  return {
    ino: 41n,
    size: BigInt(size),
    mtimeNs: 1001n,
    ctimeNs: 1002n,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function instrumentedFile(bytes, options = {}) {
  const reads = [];
  const before = stat(bytes.length);
  const after = options.after || before;
  let handleStatCalls = 0;
  return {
    reads,
    fsPromises: {
      async lstat() { return handleStatCalls === 0 ? before : after; },
      async open() {
        return {
          async stat() { handleStatCalls += 1; return handleStatCalls === 1 ? before : after; },
          async read(target, offset, length, position) {
            reads.push({ length, position });
            const available = Math.max(0, Math.min(length, bytes.length - position));
            bytes.copy(target, offset, position, position + available);
            return { bytesRead: available, buffer: target };
          },
          async close() {},
        };
      },
    },
  };
}

for (const size of [0, 1, 262143, 262144, 262145, 2 * 1024 * 1024]) {
  test(`middle fingerprint reads the exact bounded sample for ${size} bytes`, async () => {
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const fixture = instrumentedFile(bytes);
    const result = await computeBoundedMaterialFingerprint('/virtual/movie.mkv', { fsPromises: fixture.fsPromises });
    const sampleLength = Math.min(size, FINGERPRINT_SAMPLE_BYTES);
    const sampleOffset = Math.floor((size - sampleLength) / 2);
    assert.equal(result.sampleOffset, sampleOffset);
    assert.equal(result.sampleLength, sampleLength);
    assert.equal(result.bytesSampled, sampleLength);
    assert.equal(fixture.reads.reduce((sum, item) => sum + item.length, 0), sampleLength);
    assert.equal(fixture.reads.length, sampleLength === 0 ? 0 : 1);
    if (fixture.reads.length) assert.equal(fixture.reads[0].position, sampleOffset);
    assert.equal(result.contentFingerprint,
      crypto.createHash('sha256').update(bytes.subarray(sampleOffset, sampleOffset + sampleLength)).digest('hex'));
  });
}

test('bytes outside the middle sample do not change the accepted fingerprint', async () => {
  const first = Buffer.alloc(2 * 1024 * 1024, 7);
  const second = Buffer.from(first);
  second[0] = 8;
  second[second.length - 1] = 9;
  const left = instrumentedFile(first);
  const right = instrumentedFile(second);
  const leftResult = await computeBoundedMaterialFingerprint('/virtual/left.mkv', { fsPromises:left.fsPromises });
  const rightResult = await computeBoundedMaterialFingerprint('/virtual/right.mkv', { fsPromises:right.fsPromises });
  assert.equal(leftResult.contentFingerprint, rightResult.contentFingerprint);
});

test('mtime or ctime drift alone does not invalidate the sample', async () => {
  const bytes = Buffer.alloc(1024, 1);
  const fixture = instrumentedFile(bytes, { after:stat(bytes.length, { mtimeNs:2001n, ctimeNs:2002n }) });
  const result = await computeBoundedMaterialFingerprint('/virtual/touched.mkv', { fsPromises:fixture.fsPromises });
  assert.equal(result.bytesSampled, bytes.length);
  assert.equal(result.contentFingerprint,
    crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('inode or size drift invalidates the sample instead of returning evidence', async () => {
  const bytes = Buffer.alloc(1024, 1);
  for (const after of [
    stat(bytes.length, { ino: 99n }),
    stat(bytes.length + 1),
  ]) {
    const fixture = instrumentedFile(bytes, { after });
    await assert.rejects(
      computeBoundedMaterialFingerprint('/virtual/changing.mkv', { fsPromises:fixture.fsPromises }),
      (error) => error.code === 'PHYSICAL_MATERIAL_STAT_FENCE_CHANGED',
    );
  }
});

test('N files never request more than N times 256 KiB', async () => {
  const sizes=[1,262144,262145,8*1024*1024];
  let total=0,reported=0;
  for(const size of sizes){
    const fixture=instrumentedFile(Buffer.alloc(size,3));
    await computeBoundedMaterialFingerprint('/virtual/'+size+'.mkv',{fsPromises:fixture.fsPromises,
      onRead:(read)=>{reported+=read.bytesRead;assert.ok(read.requestedBytes<=FINGERPRINT_SAMPLE_BYTES);}});
    total+=fixture.reads.reduce((sum,item)=>sum+item.length,0);
  }
  assert.ok(total<=sizes.length*FINGERPRINT_SAMPLE_BYTES);
  assert.equal(reported,total);
});

test('actual large MKV, ISO, BDMV stream, and transcode output stay within the read-byte budget', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-large-media-budget-'));
  const locations=[
    path.join(root,'Movie.mkv'),
    path.join(root,'Movie.iso'),
    path.join(root,'BDMV','STREAM','00000.m2ts'),
    path.join(root,'transcode-output.mkv'),
  ];
  try {
    let totalBytesRead=0;
    for(const [index,location] of locations.entries()){
      fs.mkdirSync(path.dirname(location),{recursive:true});
      const descriptor=fs.openSync(location,'w');
      try {
        const logicalSize=64*1024*1024+index+1;
        fs.writeSync(descriptor,Buffer.from([index+1]),0,1,logicalSize-1);
      } finally {fs.closeSync(descriptor);}
      const reads=[];
      const result=computeBoundedMaterialFingerprintSync(location,{onRead:(read)=>reads.push(read)});
      assert.equal(result.bytesSampled,FINGERPRINT_SAMPLE_BYTES);
      assert.equal(reads.reduce((sum,read)=>sum+read.bytesRead,0),FINGERPRINT_SAMPLE_BYTES);
      assert.ok(reads.every((read)=>read.requestedBytes<=FINGERPRINT_SAMPLE_BYTES));
      totalBytesRead+=reads.reduce((sum,read)=>sum+read.bytesRead,0);
    }
    assert.equal(totalBytesRead,locations.length*FINGERPRINT_SAMPLE_BYTES);
  } finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('symlink, short read, disappearance, and permission errors fail with stable codes', async () => {
  const symlink=instrumentedFile(Buffer.alloc(1));
  symlink.fsPromises.lstat=async()=>stat(1,{isFile:()=>false,isSymbolicLink:()=>true});
  await assert.rejects(computeBoundedMaterialFingerprint('/virtual/link',{fsPromises:symlink.fsPromises}),
    (error)=>error.code==='PHYSICAL_MATERIAL_FILE_UNSAFE');
  const short=instrumentedFile(Buffer.alloc(2));
  short.fsPromises.open=async()=>({stat:async()=>stat(2),read:async()=>({bytesRead:0}),close:async()=>{}});
  await assert.rejects(computeBoundedMaterialFingerprint('/virtual/short',{fsPromises:short.fsPromises}),
    (error)=>error.code==='PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ');
  for(const causeCode of ['ENOENT','EACCES']){
    const failing={lstat:async()=>{const error=new Error(causeCode);error.code=causeCode;throw error;}};
    await assert.rejects(computeBoundedMaterialFingerprint('/virtual/fail',{fsPromises:failing}),
      (error)=>error.code==='PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED'&&error.details.causeCode===causeCode);
  }
});

test('Physical Material source paths contain no full-file hash contract or streaming enumerator', () => {
  const serviceRoot=path.resolve(__dirname,'../..');
  const sourceRoot=path.join(serviceRoot,'src');
  const activeFiles=[];
  const pending=[sourceRoot];
  while(pending.length){
    const directory=pending.pop();
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const absolute=path.join(directory,entry.name);
      if(entry.isDirectory())pending.push(absolute);
      else if(entry.isFile()&&/\.(?:js|json)$/.test(entry.name))activeFiles.push(path.relative(serviceRoot,absolute));
    }
  }
  const old=/content_hash|contentHash|ContentHash|PhysicalMaterialIdentity\/v1|physical-material-identity@1|shared\.material\.content_hash|HashProfile/;
  for(const relative of activeFiles){
    const source=fs.readFileSync(path.join(serviceRoot,relative),'utf8');
    assert.doesNotMatch(source,old,relative);
  }
  const enumerator=fs.readFileSync(path.join(serviceRoot,'src/clean-field-observation-enumerator.js'),'utf8');
  assert.doesNotMatch(enumerator,/createReadStream|readFile(?:Sync)?\s*\(/);
});
