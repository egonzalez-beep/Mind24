/**
 * Render HTML → PDF (Puppeteer).
 * Producción Railway: @sparticuz/chromium. Local: PUPPETEER_EXECUTABLE_PATH o Chrome del sistema.
 */
let browserPromise = null;
let launchOverride = null;

/** Solo para pruebas. En producción queda en null y el arranque es el de siempre. */
export function setPdfBrowserLauncherForTests(launcher) {
  launchOverride = typeof launcher === 'function' ? launcher : null;
}

/** Solo para pruebas. Permite comprobar que el singleton volvió a null. */
export function getPdfBrowserPromiseForTests() {
  return browserPromise;
}

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

async function launchChromium() {
  if (launchOverride) return launchOverride();
  const { puppeteer, options } = await resolveLaunchOptions();
  return puppeteer.launch(options);
}

function beginBrowserLaunch() {
  const pending = (async () => {
    try {
      return await launchChromium();
    } catch (err) {
      if (browserPromise === pending) browserPromise = null;
      throw err;
    }
  })();
  browserPromise = pending;
  pending.catch(() => {});
  return pending;
}

async function getBrowser() {
  if (!browserPromise) beginBrowserLaunch();
  const current = browserPromise;
  const browser = await current;
  let connected = false;
  try {
    connected = Boolean(browser) && browser.connected !== false;
  } catch {
    connected = false;
  }
  if (connected) return browser;
  if (browserPromise === current) beginBrowserLaunch();
  return browserPromise;
}

/**
 * Cierra el Chromium compartido y deja el singleton listo para un arranque nuevo.
 * Las suites lo llaman al terminar. Producción no lo usa entre PDF.
 */
export async function closePdfBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  let browser;
  try {
    browser = await pending;
  } catch {
    return;
  }
  let disconnected = !browser;
  if (browser) {
    try {
      disconnected = browser.connected === false;
    } catch {
      disconnected = true;
    }
  }
  if (disconnected) return;
  try {
    await browser.close();
  } catch {
    // El proceso ya se desconectó.
  }
}

export async function renderHtmlToPdfBuffer(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    const pdfOptions = {
      format: options.format || 'A4',
      landscape: options.landscape === true,
      printBackground: true,
      margin: options.margin || { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    };
    if (options.displayHeaderFooter === true) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = options.headerTemplate || '<span></span>';
      pdfOptions.footerTemplate = options.footerTemplate || '<span></span>';
    }
    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
