const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src = path.resolve(__dirname, '../../..', 'icon', 'shelfdeck_logo_transparent.png');
const publicDir = path.resolve(__dirname, '..', 'public');

async function main() {
  // 48x48 for sidebar logo
  await sharp(src).resize(48, 48).png().toFile(path.join(publicDir, 'logo-48.png'));

  // 96x96 for retina
  await sharp(src).resize(96, 96).png().toFile(path.join(publicDir, 'logo-96.png'));

  console.log('Logo generated in', publicDir);
}

main().catch(err => { console.error(err); process.exit(1); });
