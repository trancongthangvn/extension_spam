import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'out');

if (!fs.existsSync(outDir)) {
  throw new Error('Missing out/ directory. Run `next build` first.');
}

const oldNextDir = path.join(outDir, '_next');
const newNextDir = path.join(outDir, 'next-assets');

if (fs.existsSync(newNextDir)) {
  fs.rmSync(newNextDir, { recursive: true, force: true });
}
if (fs.existsSync(oldNextDir)) {
  fs.renameSync(oldNextDir, newNextDir);
}

// Recursively replace /_next/ references in .html, .js, .css files inside out/
function rewriteNextPaths(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteNextPaths(fullPath);
    } else if (/\.(html|js|css|json)$/i.test(entry.name)) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('/_next/')) {
        content = content.replaceAll('/_next/', './next-assets/');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

rewriteNextPaths(outDir);

// Extract inline <script> blocks from out/index.html for Chrome MV3 CSP compliance
const indexHtmlPath = path.join(outDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  let html = fs.readFileSync(indexHtmlPath, 'utf8');
  let inlineIdx = 0;

  html = html.replace(/<script(?![^>]*\bsrc\b)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, code) => {
    const trimmed = code.trim();
    if (!trimmed) return '';
    const fileName = `inline-${inlineIdx++}.js`;
    fs.writeFileSync(path.join(newNextDir, fileName), trimmed, 'utf8');
    return `<script src="./next-assets/${fileName}"${attrs}></script>`;
  });

  // Ensure relative icon path inside extension popup
  html = html.replaceAll('src="/icons/', 'src="./icons/');
  fs.writeFileSync(indexHtmlPath, html, 'utf8');
}

// Copy extension runtime files into out/
for (const file of ['manifest.json', 'content.js', 'content.css']) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, file));
  }
}

// Remove any remaining underscore-prefixed files/folders in out/ root (Chrome MV3 forbids them)
for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
  if (entry.name.startsWith('_') && entry.name !== '_metadata' && entry.name !== '_locales') {
    fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
  }
}

console.log('✅ Chrome Extension MV3 build ready in out/');
