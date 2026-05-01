const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.resolve(__dirname, '../../..', 'icon', 'shelfdeck_icon_B_tri1.svg');
const publicDir = path.resolve(__dirname, '..', 'public');

async function main() {
  const svg = fs.readFileSync(svgPath);

  // favicon-32.png
  await sharp(svg).resize(32, 32).png().toFile(path.join(publicDir, 'favicon-32.png'));

  // favicon.svg (copy)
  fs.copyFileSync(svgPath, path.join(publicDir, 'favicon.svg'));

  // apple-touch-icon (180x180)
  await sharp(svg).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));

  // and a larger icon for general use
  await sharp(svg).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));

  console.log('Icons generated in', publicDir);
}

main().catch(err => { console.error(err); process.exit(1); });
