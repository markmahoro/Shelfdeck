'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Agent, EnvHttpProxyAgent, fetch } = require('undici');

/** Create an undici dispatcher that honors standard proxy env vars when present. */
function createDispatcher(timeoutMs = 60000) {
  const hasProxy = Boolean(
    process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy,
  );
  return hasProxy
    ? new EnvHttpProxyAgent({ connect: { family: 4, timeout: timeoutMs } })
    : new Agent({ connect: { family: 4, timeout: timeoutMs } });
}

async function fetchJson(url, dispatcher) {
  const response = await fetch(url, {
    dispatcher,
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.json();
}

async function downloadToFile(url, destPath, dispatcher) {
  const response = await fetch(url, {
    dispatcher,
    redirect: 'follow',
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }
  const fd = fs.openSync(destPath, 'wx', 0o600);
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
      }
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!bytes) {
    throw new Error(`Downloaded empty package from ${url}`);
  }
}

async function resolveNugetPackageUrl(feedIndexUrl, packageName, version, dispatcher) {
  const nugetIndex = await fetchJson(feedIndexUrl, dispatcher);
  const base = nugetIndex?.resources?.find((entry) => entry['@type'] === 'PackageBaseAddress/3.0.0')?.['@id'];
  if (!base) {
    throw new Error(`Missing PackageBaseAddress/3.0.0 in NuGet index ${feedIndexUrl}`);
  }
  const packageBaseUrl = base.endsWith('/') ? base : `${base}/`;
  const pkgLower = packageName.toLowerCase();
  const verLower = version.toLowerCase();
  const versionsDoc = await fetchJson(`${packageBaseUrl}${pkgLower}/index.json`, dispatcher);
  if (!Array.isArray(versionsDoc?.versions) || !versionsDoc.versions.includes(verLower)) {
    throw new Error(`Package ${packageName}@${version} not listed in ${feedIndexUrl}`);
  }
  return {
    url: `${packageBaseUrl}${pkgLower}/${verLower}/${pkgLower}.${verLower}.nupkg`,
    fileName: `${pkgLower}.${verLower}.nupkg`,
  };
}

/**
 * Download and extract native ONNX Runtime execution-provider binaries pinned by
 * onnxruntime-node's install-metadata.js without global-agent's Node 20 TLS proxy bug.
 */
async function installOnnxRuntimeCuda({ flag = process.env.ONNXRUNTIME_NODE_INSTALL || 'cuda12' } = {}) {
  const normalizedFlag = String(flag || '').trim();
  if (!normalizedFlag || ['skip', 'false', '0'].includes(normalizedFlag)) {
    return { skipped: true, reason: 'disabled' };
  }
  const ortRoot = path.dirname(require.resolve('onnxruntime-node/package.json'));
  const metadata = require(path.join(ortRoot, 'script', 'install-metadata.js'));
  const AdmZip = require(require.resolve('adm-zip', { paths: [ortRoot] }));
  const platform = `${process.platform}/${process.arch}`;
  const supported = metadata.requirements?.[platform] || [];
  if (!supported.length) {
    return { skipped: true, reason: 'no_platform_requirement', platform };
  }
  if (!supported.includes(normalizedFlag)) {
    throw new Error(`Unsupported ONNXRUNTIME_NODE_INSTALL=${normalizedFlag} for ${platform}`);
  }
  const manifest = metadata.manifests?.[`${platform}:${normalizedFlag}`];
  if (!manifest) {
    throw new Error(`Manifest not found for ${platform}:${normalizedFlag}`);
  }

  const binFolder = path.join(ortRoot, 'bin', 'napi-v6', platform);
  const byPackage = new Map();
  for (const [filename, spec] of Object.entries(manifest)) {
    const destPath = path.resolve(binFolder, filename);
    if (destPath !== binFolder && !destPath.startsWith(binFolder + path.sep)) {
      throw new Error(`Manifest target escapes binary directory: ${filename}`);
    }
    if (!byPackage.has(spec.package)) {
      byPackage.set(spec.package, []);
    }
    byPackage.get(spec.package).push({ destPath, pathInPackage: spec.path });
  }

  const dispatcher = createDispatcher();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-cuda-'));
  const extracted = [];
  try {
    for (const [packageKey, entries] of byPackage.entries()) {
      const candidates = metadata.packages?.[packageKey];
      const target = candidates?.versions?.[0];
      const feed = target && metadata.feeds?.[target.feed];
      if (!candidates || !target || !feed) {
        throw new Error(`Missing package metadata for ${packageKey}`);
      }
      const { url, fileName } = await resolveNugetPackageUrl(feed.index, candidates.name, target.version, dispatcher);
      const nupkgPath = path.join(tempDir, `${randomUUID()}-${fileName}`);
      await downloadToFile(url, nupkgPath, dispatcher);
      const zip = new AdmZip(nupkgPath);
      for (const { destPath, pathInPackage } of entries) {
        const zipEntry = zip.getEntry(pathInPackage);
        if (!zipEntry) {
          throw new Error(`Missing ${pathInPackage} inside ${fileName}`);
        }
        const buffer = zip.readFile(zipEntry);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, buffer, { mode: 0o755 });
        fs.chmodSync(destPath, 0o755);
        extracted.push(destPath);
      }
    }
    return { skipped: false, platform, flag: normalizedFlag, extractedCount: extracted.length };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await dispatcher.close();
  }
}

if (require.main === module) {
  installOnnxRuntimeCuda()
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error) => {
      process.stderr.write((error?.stack || error?.message || String(error)) + '\n');
      process.exitCode = 1;
    });
}

module.exports = Object.freeze({ installOnnxRuntimeCuda });
