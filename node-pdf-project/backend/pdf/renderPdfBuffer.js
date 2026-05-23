const path = require('path');

function getChromium() {
  try {
    return require('@sparticuz/chromium');
  } catch (e) {
    const fallback = path.join(process.cwd(), 'node_modules', '@sparticuz', 'chromium');
    try {
      return require(fallback);
    } catch {
      return null;
    }
  }
}

function getPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (e) {
    const fallback = path.join(process.cwd(), 'node_modules', 'puppeteer-core');
    try {
      return require(fallback);
    } catch {
      // fall through
    }
  }
  try {
    return require('puppeteer');
  } catch (e) {
    const fallback = path.join(process.cwd(), 'node_modules', 'puppeteer');
    return require(fallback);
  }
}

const puppeteer = getPuppeteer();
const chromium = getChromium();

async function renderPdfBuffer({ html }) {
  const envExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const chromiumExecutablePath =
    chromium && typeof chromium.executablePath === 'function'
      ? await chromium.executablePath()
      : undefined;

  const executablePath = envExecutablePath || chromiumExecutablePath;

  const launchArgs = [
    ...(chromium && Array.isArray(chromium.args) ? chromium.args : []),
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ];

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: launchArgs,
  });

  try {
    const page = await browser.newPage();

    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);

    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });

    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const waitForImages = (timeoutMs) => {
        const imgs = Array.from(document.images);
        const promises = imgs.map(
          (img) =>
            new Promise((resolve) => {
              if (img.complete) return resolve({ ok: true });
              const done = () => resolve({ ok: true });
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
            })
        );

        return Promise.race([
          Promise.all(promises),
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs))
        ]);
      };

      await waitForImages(25_000);
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      scale: 0.9
    });

    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdfBuffer };
