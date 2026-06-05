const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

function getMimeType(ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return map[ext.toLowerCase()] || 'image/png';
}

async function logoToDataUri(logoPathOrUrl, maxWidth = 600) {
  if (!logoPathOrUrl) return null;
  const trimmed = String(logoPathOrUrl).trim();
  if (!trimmed) return null;

  // Already a URL (http/https/data)
  if (/^https?:\/\//.test(trimmed) || /^data:/.test(trimmed)) {
    console.log('[logoToDataUri] Using URL directly:', trimmed.substring(0, 50) + '...');
    return trimmed;
  }

  // Local file path - try to read and convert to base64
  try {
    const resolved = path.resolve(trimmed);
    console.log('[logoToDataUri] Resolving path:', trimmed, '->', resolved);
    if (!fs.existsSync(resolved)) {
      console.warn('[logoToDataUri] Logo file not found:', resolved);
      return null;
    }
    
    const ext = path.extname(resolved);
    const mime = getMimeType(ext);
    
    // Resize image if sharp is available
    let buffer;
    if (sharp && mime !== 'image/svg+xml') {
      console.log('[logoToDataUri] Resizing image to max width:', maxWidth);
      buffer = await sharp(resolved)
        .resize(maxWidth, null, { withoutEnlargement: true })
        .png({ quality: 90 })
        .toBuffer();
      console.log('[logoToDataUri] Resized image size:', buffer.length, 'bytes');
    } else {
      buffer = fs.readFileSync(resolved);
    }
    
    const base64 = buffer.toString('base64');
    const dataUri = `data:${mime === 'image/svg+xml' ? 'image/svg+xml' : 'image/png'};base64,${base64}`;
    console.log('[logoToDataUri] Successfully created data URI, length:', dataUri.length);
    return dataUri;
  } catch (err) {
    console.error('[logoToDataUri] Failed to read logo file:', err);
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function groupByCategory(products) {
  return products.reduce((acc, p) => {
    const display = String(p.category || 'Uncategorized').trim() || 'Uncategorized';
    const key = display.toLowerCase();
    if (!acc[key]) acc[key] = { title: display, items: [] };
    acc[key].items.push(p);
    return acc;
  }, {});
}

function normalizeTitle(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function buildCoverPage({ title, logoUrl }) {
  const safe = String(title || '').trim();
  if (!safe) return '';

  const resolvedLogo = await logoToDataUri(logoUrl, 600);
  const logoHtml = resolvedLogo
    ? `<div class="coverLogo"><img src="${escapeHtml(resolvedLogo)}" alt="Logo" width="300" height="120" style="max-height:120px;max-width:300px;object-fit:contain;" /></div>`
    : '';

  return `
    <section class="page coverPage">
      ${logoHtml}
      <div class="coverTitle">${escapeHtml(safe)}</div>
    </section>
  `;
}

async function buildPage({ category, pageProducts, showTitle, logoUrl }) {
  const isSingle = pageProducts.length === 1;
  const resolvedLogo = await logoToDataUri(logoUrl, 400);
  const pageLogoHtml = resolvedLogo
    ? `<div class="pageLogo"><img src="${escapeHtml(resolvedLogo)}" alt="Logo" width="200" height="60" style="max-height:60px;max-width:200px;object-fit:contain;" /></div>`
    : '';

  const productCards = pageProducts
    .map((p) => {
      const priceText = typeof p.price === 'number' ? `₹${p.price}` : String(p.price);
      return `
        <div class="product">
          <div class="imgWrap">
            <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" />
          </div>
          <div class="meta">
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="row">
              <div class="size">${escapeHtml(p.size)}</div>
              <div class="price">MRP: ${escapeHtml(priceText)}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <section class="page">
      ${pageLogoHtml}
      ${
        showTitle
          ? `<div class="banner">
        <div class="bannerTitle">${escapeHtml(category)}</div>
      </div>`
          : ''
      }

      <div class="content ${isSingle ? 'single' : ''}">
        <div class="grid">
          ${productCards}
        </div>
      </div>
    </section>
  `;
}

async function buildBrochureHtml({ products, maxPerPage, coverTitle, logoUrl }) {
  const effectiveLogoUrl = logoUrl || './assets/logo.png';
  const perPage = Number.isFinite(maxPerPage) && maxPerPage > 0 ? maxPerPage : 9;
  const grouped = groupByCategory(products);
  const categories = Object.keys(grouped).filter((c) => grouped[c]?.items?.length);

  const pagePromises = [];
  let previousTitle = null;
  for (const category of categories) {
    const chunks = chunkArray(grouped[category].items, perPage);
    for (let i = 0; i < chunks.length; i++) {
      const pageProducts = chunks[i];
      const currentTitle = grouped[category].title;
      const showTitle = normalizeTitle(currentTitle) !== normalizeTitle(previousTitle);
      previousTitle = currentTitle;
      pagePromises.push(
        buildPage({ category: currentTitle, pageProducts, showTitle, logoUrl: effectiveLogoUrl })
      );
    }
  }

  const pages = await Promise.all(pagePromises);
  const cover = await buildCoverPage({ title: coverTitle, logoUrl: effectiveLogoUrl });
  const allPages = cover ? [cover, ...pages] : pages;

  const body = allPages
    .map((p, idx) => {
      const needsBreak = idx < allPages.length - 1;
      return `${p}${needsBreak ? '<div class="pageBreak"></div>' : ''}`;
    })
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page {
            size: A4;
            margin: 14mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
          }

          .page {
            min-height: 1000px;
          }

          .coverPage {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 24px;
          }

          .coverLogo {
            margin-bottom: 8px;
          }

          .coverLogo img {
            max-height: 120px;
            max-width: 300px;
            object-fit: contain;
          }

          .coverTitle {
            font-size: 42px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            text-align: center;
            padding: 0 18px;
          }

          .banner {
            width: 100%;
            background: #1d3f7b;
            border-radius: 12px;
            padding: 14px 18px;
          }

          .bannerTitle {
            color: #ffffff;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 0.2px;
            text-transform: uppercase;
          }

          .pageLogo {
            padding: 0 18px 12px 18px;
            text-align: center;
          }

          .pageLogo img {
            max-height: 60px;
            max-width: 200px;
            object-fit: contain;
          }

          .content {
            padding-top: 12px;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            align-content: start;
          }

          .content.single .grid {
            grid-template-columns: 1fr;
            max-width: 360px;
            margin: 0 auto;
          }

          .product {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            overflow: hidden;
            background: #ffffff;
            display: flex;
            flex-direction: column;
            min-height: 200px;
          }

          .imgWrap {
            height: 245px;
            background: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0px;
          }

          .imgWrap img {
            width: 100%;
            height: 100%;
            max-width: none;
            max-height: none;
            object-fit: cover;
          }

          .meta {
            padding: 10px 10px 12px 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .name {
            font-weight: 800;
            font-size: 13px;
            line-height: 1.2;
            min-height: 30px;
          }

          .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            font-size: 12px;
            color: #334155;
          }

          .price {
            font-weight: 800;
            color: #0f172a;
          }

          .pageBreak {
            page-break-after: always;
          }
        </style>
      </head>
      <body>
        ${body}
      </body>
    </html>
  `;
}

module.exports = { buildBrochureHtml };
