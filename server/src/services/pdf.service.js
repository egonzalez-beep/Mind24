/**
 * Render HTML → PDF (Puppeteer).
 * Producción Railway: @sparticuz/chromium. Local: PUPPETEER_EXECUTABLE_PATH o Chrome del sistema.
 */
let browserPromise = null;

async function resolveLaunchOptions() {
  const customPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (customPath) {
    const puppeteer = await import('puppeteer-core');
    return {
      puppeteer,
      options: {
        executablePath: customPath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    };
  }

  try {
    const chromium = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');
    return {
      puppeteer,
      options: {
        args: chromium.default.args,
        defaultViewport: chromium.default.defaultViewport,
        executablePath: await chromium.default.executablePath(),
        headless: chromium.default.headless,
      },
    };
  } catch {
    const puppeteer = await import('puppeteer');
    return {
      puppeteer,
      options: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    };
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const { puppeteer, options } = await resolveLaunchOptions();
    browserPromise = puppeteer.launch(options);
  }
  return browserPromise;
}

export async function renderHtmlToPdfBuffer(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
