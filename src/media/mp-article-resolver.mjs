function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/&amp;/g, '&');
}

function getTrimmedText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function loadPlaywrightModule() {
  const errors = [];
  for (const specifier of ['playwright', 'playwright-core']) {
    try {
      return await import(specifier);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `Playwright is not installed. Install \"playwright\" or \"playwright-core\" first. (${errors.join(' | ')})`,
  );
}

function resolveChromium(playwrightModule) {
  const chromium = playwrightModule?.chromium || playwrightModule?.default?.chromium;
  if (!chromium?.launch) {
    throw new Error('Playwright chromium launcher is unavailable');
  }
  return chromium;
}

function buildLaunchOptions(options = {}) {
  const launchOptions = {
    headless: true,
  };

  if (typeof options.browserExecutablePath === 'string' && options.browserExecutablePath.trim()) {
    launchOptions.executablePath = options.browserExecutablePath.trim();
  } else {
    launchOptions.channel = typeof options.browserChannel === 'string' && options.browserChannel.trim()
      ? options.browserChannel.trim()
      : 'msedge';
  }

  return launchOptions;
}

function normalizeArticlePayload(payload) {
  const articleText = getTrimmedText(payload?.contentText || payload?.bodyText || payload?.documentText || '');
  const articleHtml = typeof payload?.contentHtml === 'string' ? payload.contentHtml.trim() : '';

  return {
    provider: 'playwright',
    final_url: normalizeUrl(payload?.finalUrl || payload?.url || ''),
    title: getTrimmedText(payload?.title || ''),
    source: getTrimmedText(payload?.source || payload?.accountName || payload?.nickname || ''),
    author: getTrimmedText(payload?.author || ''),
    publish_time: getTrimmedText(payload?.publishTime || ''),
    content_text: articleText,
    content_html: articleHtml,
    excerpt: articleText ? articleText.slice(0, 400) : '',
  };
}

export async function resolveMpArticleWithBrowser(params = {}) {
  const url = normalizeUrl(params.url);
  if (!url) {
    throw new Error('url is required');
  }

  const timeoutMs = Number.isFinite(Number(params.timeoutMs))
    ? Math.min(Math.max(Number(params.timeoutMs), 5_000), 120_000)
    : 30_000;

  const playwrightModule = await loadPlaywrightModule();
  const chromium = resolveChromium(playwrightModule);
  const browser = await chromium.launch(buildLaunchOptions(params));

  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 1600 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 10_000) });
    } catch {
      // Ignore network-idle timeouts; many mp pages keep background requests alive.
    }

    const payload = await page.evaluate(() => {
      const pickText = (...selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node && typeof node.textContent === 'string') {
            const text = node.textContent.replace(/\s+/g, ' ').trim();
            if (text) {
              return text;
            }
          }
        }
        return '';
      };

      const contentNode = document.querySelector('#js_content') || document.querySelector('.rich_media_content');
      const bodyNode = document.body;

      return {
        url: window.location.href,
        finalUrl: window.location.href,
        title: pickText('#activity-name', '.rich_media_title', 'h1') || document.title || '',
        source: pickText('#js_name', '.account_nickname_inner', '.rich_media_meta_nickname'),
        author: pickText('#js_author_name', '.rich_media_meta_text'),
        publishTime: pickText('#publish_time', '.rich_media_meta.rich_media_meta_text'),
        contentText: contentNode?.textContent?.replace(/\s+/g, ' ').trim() || '',
        bodyText: bodyNode?.innerText?.replace(/\s+/g, ' ').trim() || '',
        contentHtml: contentNode?.innerHTML || '',
      };
    });

    const article = normalizeArticlePayload(payload);
    if (!article.content_text) {
      throw new Error('Article body text is empty');
    }

    return {
      url,
      ...article,
    };
  } finally {
    await browser.close();
  }
}