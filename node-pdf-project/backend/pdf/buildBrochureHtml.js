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

function buildCoverPage({ title }) {
  const safe = String(title || '').trim();
  if (!safe) return '';

  return `
    <section class="page coverPage">
      <div class="coverTitle">${escapeHtml(safe)}</div>
    </section>
  `;
}

function buildPage({ category, pageProducts, showTitle }) {
  const isSingle = pageProducts.length === 1;

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

function buildBrochureHtml({ products, maxPerPage, coverTitle }) {
  const perPage = Number.isFinite(maxPerPage) && maxPerPage > 0 ? maxPerPage : 9;
  const grouped = groupByCategory(products);
  const categories = Object.keys(grouped).filter((c) => grouped[c]?.items?.length);

  const pages = [];
  let previousTitle = null;
  for (const category of categories) {
    const chunks = chunkArray(grouped[category].items, perPage);
    for (let i = 0; i < chunks.length; i++) {
      const pageProducts = chunks[i];
      const currentTitle = grouped[category].title;
      const showTitle = normalizeTitle(currentTitle) !== normalizeTitle(previousTitle);
      previousTitle = currentTitle;
      pages.push(
        buildPage({ category: currentTitle, pageProducts, showTitle })
      );
    }
  }

  const cover = buildCoverPage({ title: coverTitle });
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
            align-items: center;
            justify-content: center;
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
            background: #16a34a;
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
            height: 230px;
            background: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px;
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
