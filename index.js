const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '10mb' }));

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

app.get('/health', (req, res) => {
  if (!BROWSERLESS_TOKEN) {
    return res.status(500).json({
      status: 'unhealthy',
      message: 'BROWSERLESS_TOKEN not configured'
    });
  }

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    browserlessConfigured: !!BROWSERLESS_TOKEN
  });
});

function getCDPWebSocketUrl() {
  if (!BROWSERLESS_TOKEN) {
    throw new Error('BROWSERLESS_TOKEN not configured');
  }
  return `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}`;
}

function getAnalysisScript() {
  return `
const puppeteer = require('puppeteer-core');

module.exports = async ({ url, urls = [], loginConfig }) => {
  const features = [];
  const logs = [];
  let loginSuccess = false;

  const log = (msg) => {
    logs.push(msg);
  };

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    log('Script started - Analyzing ' + urls.length + ' page(s)');

    // Support both formats: username/password OR testUsername/testPassword
    const username = loginConfig?.username || loginConfig?.testUsername;
    const password = loginConfig?.password || loginConfig?.testPassword;

    log('Login config received: ' + JSON.stringify({
      hasConfig: !!loginConfig,
      hasLoginUrl: !!(loginConfig && loginConfig.loginUrl),
      hasUsername: !!username,
      hasPassword: !!password
    }));

    // Step 1: Handle login if credentials provided
    if (loginConfig && loginConfig.loginUrl && username && password) {
      log('Navigating to login page: ' + loginConfig.loginUrl);
      await page.goto(loginConfig.loginUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await wait(2000);

      const htmlPreview = await page.content();
      log('Page loaded (' + htmlPreview.length + ' bytes)');
      log('HTML preview: ' + htmlPreview.substring(0, 300));
      log('Looking for login form...');

      // Login form detection logic
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[name="login"]',
        'input[name="user"]',
        'input[name="nom"]',
        'input[type="email"]',
        'input[type="text"][name*="email" i]',
        'input[type="text"][name*="user" i]',
        'input[placeholder*="username" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="nom" i]',
        'input[placeholder*="utilisateur" i]',
        'input[placeholder*="identifiant" i]',
        'input[id*="username" i]',
        'input[id*="email" i]',
        'input[id*="login" i]',
        'input[id*="user" i]',
        'input[aria-label*="email" i]',
        'input[aria-label*="username" i]',
        'input[aria-label*="nom" i]'
      ];

      const passwordSelectors = [
        'input[name="password"]',
        'input[name="passwd"]',
        'input[name="pwd"]',
        'input[name="motdepasse"]',
        'input[name="mot_de_passe"]',
        'input[type="password"]',
        'input[id*="password" i]',
        'input[id*="passwd" i]',
        'input[id*="pwd" i]',
        'input[id*="motdepasse" i]',
        'input[placeholder*="password" i]',
        'input[placeholder*="mot de passe" i]',
        'input[placeholder*="motdepasse" i]',
        'input[aria-label*="password" i]',
        'input[aria-label*="mot de passe" i]'
      ];

      let usernameInput = null;
      for (const selector of usernameSelectors) {
        try {
          usernameInput = await page.$(selector);
          if (usernameInput) {
            log('Found username field: ' + selector);
            break;
          }
        } catch (e) {}
      }

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await page.$(selector);
          if (passwordInput) {
            log('Found password field: ' + selector);
            break;
          }
        } catch (e) {}
      }

      if (usernameInput && passwordInput) {
        log('Filling login credentials...');
        await usernameInput.type(username);
        await passwordInput.type(password);

        const submitSelectors = [
          // Standard buttons
          'button[type="submit"]',
          'input[type="submit"]',
          'input[type="button"][id*="login" i]',
          'input[type="button"][id*="connexion" i]',
          'input[type="button"][value*="login" i]',
          'input[type="button"][value*="connexion" i]',
          // Button elements with text
          'button:has-text("Login")',
          'button:has-text("Log in")',
          'button:has-text("Sign in")',
          'button:has-text("Se connecter")',
          'button:has-text("Connexion")',
          'button:has-text("Entrer")',
          'button:has-text("Valider")',
          'button[value*="login" i]',
          'button[value*="connexion" i]',
          // DIVs with role or tabindex (interactive)
          'div[role="button"]:has-text("Se connecter")',
          'div[role="button"]:has-text("Connexion")',
          'div[role="button"]:has-text("Login")',
          'div[role="button"]:has-text("Sign in")',
          'div[tabindex="0"]:has-text("Se connecter")',
          'div[tabindex="0"]:has-text("Connexion")',
          'div[tabindex="0"]:has-text("Login")',
          'div[tabindex="0"]:has-text("Sign in")',
          // DIVs with button-like classes
          'div[class*="btn"]:has-text("Se connecter")',
          'div[class*="btn"]:has-text("Connexion")',
          'div[class*="btn"]:has-text("Login")',
          'div[class*="button"]:has-text("Se connecter")',
          'div[class*="button"]:has-text("Connexion")',
          'div[class*="button"]:has-text("Login")',
          // Plain DIVs with text (fallback - less specific)
          'div:has-text("Se connecter")',
          'div:has-text("Connexion")',
          'div:has-text("Login")',
          'div:has-text("Sign in")',
          // SPANs
          'span[role="button"]:has-text("Se connecter")',
          'span[role="button"]:has-text("Connexion")',
          'span[role="button"]:has-text("Login")',
          'span:has-text("Se connecter")',
          'span:has-text("Connexion")',
          // Links used as buttons
          'a[href*="login"]:has-text("Se connecter")',
          'a[href*="login"]:has-text("Connexion")',
          'a:has-text("Se connecter")',
          'a:has-text("Connexion")'
        ];

        let submitButton = null;
        for (const selector of submitSelectors) {
          try {
            submitButton = await page.$(selector);
            if (submitButton) {
              log('Found submit button: ' + selector);
              break;
            }
          } catch (e) {}
        }

        if (submitButton) {
          log('Clicking login button...');
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
            submitButton.click()
          ]);
          await wait(2000);

          log('Verifying login success...');
          const loginFailed = await page.evaluate(() => {
            const errorSelectors = [
              'div[class*="error"]', 'span[class*="error"]', 'p[class*="error"]',
              'div[class*="alert"]', 'div[class*="danger"]', 'div[class*="invalid"]',
              'div[role="alert"]', '[aria-invalid="true"]'
            ];

            for (const selector of errorSelectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent?.toLowerCase() || '';
                if (text.includes('incorrect') || text.includes('invalid') || text.includes('wrong') ||
                    text.includes('failed') || text.includes('erreur') || text.includes('incorrecte') ||
                    text.includes('invalide') || text.includes('échoué') || text.includes('echec')) {
                  return { failed: true, message: el.textContent?.trim() || 'Login failed' };
                }
              }
            }

            const passwordField = document.querySelector('input[type="password"]');
            const currentUrl = window.location.href;

            if (passwordField && (currentUrl.includes('login') || currentUrl.includes('auth') || currentUrl.includes('signin'))) {
              return { failed: true, message: 'Still on login page - credentials may be incorrect' };
            }

            return { failed: false, message: '' };
          });

          if (loginFailed.failed) {
            log('Login failed: ' + loginFailed.message);
            return {
              error: 'Login failed: ' + loginFailed.message + '. Please verify your credentials.',
              features: [],
              loginSuccess: false,
              pagesAnalyzed: 0,
              logs: logs
            };
          }

          loginSuccess = true;
          log('Login completed successfully');
        } else {
          log('Submit button not found, pressing Enter...');
          await passwordInput.press('Enter');
          await wait(3000);
          log('Login submitted via Enter key');
          loginSuccess = true;
        }
      } else {
        log('Login form not found, credentials may not be needed or form structure is non-standard');
      }
    }

    // Step 2: Analyze each URL with deduplication tracking
    const elementTracker = new Map(); // fingerprint -> { feature, pages: [] }

    for (let i = 0; i < urls.length; i++) {
      const targetUrl = urls[i];
      log('Analyzing page ' + (i + 1) + '/' + urls.length + ': ' + targetUrl);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await wait(2000);
        log('Page loaded, extracting elements...');

        // Extract elements with position detection and fingerprinting
        const pageFeatures = await page.evaluate((pageUrl) => {
          const features = [];

          // Helper to detect if element is in global area
          const isInGlobalArea = (element) => {
            let current = element;
            while (current && current !== document.body) {
              const tagName = current.tagName?.toLowerCase() || '';
              const role = current.getAttribute('role') || '';
              const className = current.className || '';
              const id = current.id || '';

              if (tagName === 'header' || tagName === 'footer' || tagName === 'nav') return true;
              if (role === 'banner' || role === 'navigation' || role === 'contentinfo') return true;
              if (typeof className === 'string' && (className.includes('header') || className.includes('footer') ||
                  className.includes('navbar') || className.includes('nav-') || className.includes('menu'))) return true;
              if (typeof id === 'string' && (id.includes('header') || id.includes('footer') ||
                  id.includes('nav') || id.includes('menu'))) return true;

              current = current.parentElement;
            }
            return false;
          };

          // Helper to generate element fingerprint
          const getElementFingerprint = (type, text, selector = '') => {
            const normalized = text.toLowerCase().trim().replace(/\\s+/g, ' ');
            return type + ':' + normalized + ':' + selector;
          };

          // Forms
          const forms = document.querySelectorAll('form');
          forms.forEach((form, index) => {
            if (index >= 5) return;

            const inputs = form.querySelectorAll('input, select, textarea');
            if (inputs.length === 0) return;

            const inputDetails = Array.from(inputs).map(el => ({
              name: el.getAttribute('name') || el.getAttribute('id') || '',
              type: el.getAttribute('type') || el.tagName.toLowerCase(),
              placeholder: el.getAttribute('placeholder') || '',
            }));

            const fieldNames = inputDetails.map(i => i.name + ' ' + i.placeholder).join(' ').toLowerCase();

            let formType = 'data-entry';
            let formPurpose = 'Data Entry Form';

            if (fieldNames.includes('email') && fieldNames.includes('password') && !fieldNames.includes('confirm')) {
              formType = 'login';
              formPurpose = 'Login Form';
            } else if (fieldNames.includes('search') || fieldNames.includes('query')) {
              formType = 'search';
              formPurpose = 'Search Form';
            } else if (fieldNames.includes('card') || fieldNames.includes('payment')) {
              formType = 'payment';
              formPurpose = 'Payment Form';
            } else if (fieldNames.includes('register') || fieldNames.includes('signup')) {
              formType = 'registration';
              formPurpose = 'Registration Form';
            }

            const isGlobal = isInGlobalArea(form);
            const fingerprint = getElementFingerprint('form', formPurpose, formType);

            features.push({
              type: 'form',
              formType,
              purpose: formPurpose,
              inputs: inputDetails,
              pageUrl,
              isGlobal,
              fingerprint
            });
          });

          // Buttons
          const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
          buttons.forEach((button, index) => {
            if (index >= 15) return;

            const text = button.textContent?.trim() || button.getAttribute('value') || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            const displayText = text || ariaLabel;

            if (displayText.length > 0 && displayText.length < 50) {
              const isGlobal = isInGlobalArea(button);
              const fingerprint = getElementFingerprint('button', displayText);

              features.push({
                type: 'button',
                text: displayText,
                pageUrl,
                isGlobal,
                fingerprint
              });
            }
          });

          // Links
          const links = document.querySelectorAll('a[href]');
          links.forEach((link, index) => {
            if (index >= 15) return;

            const href = link.getAttribute('href');
            const text = link.textContent?.trim() || '';

            if (href && !href.startsWith('#') && !href.startsWith('javascript:') && text.length > 0 && text.length < 50) {
              const isGlobal = isInGlobalArea(link);
              const fingerprint = getElementFingerprint('link', text, href);

              features.push({
                type: 'link',
                text,
                href,
                pageUrl,
                isGlobal,
                fingerprint
              });
            }
          });

          return features;
        }, targetUrl);

        log('Found ' + pageFeatures.length + ' features on ' + targetUrl);

        // Track elements globally to detect duplicates
        pageFeatures.forEach(feature => {
          if (!feature.fingerprint) return;

          if (!elementTracker.has(feature.fingerprint)) {
            elementTracker.set(feature.fingerprint, {
              feature: feature,
              pages: [feature.pageUrl]
            });
          } else {
            const existing = elementTracker.get(feature.fingerprint);
            if (!existing.pages.includes(feature.pageUrl)) {
              existing.pages.push(feature.pageUrl);
            }
          }
        });

      } catch (error) {
        log('Error analyzing ' + targetUrl + ': ' + error.message);
      }
    }

    // Convert tracked elements to features array with dedup info
    elementTracker.forEach((data) => {
      const feature = data.feature;
      feature.appearsOnPages = data.pages;
      feature.isGlobal = feature.isGlobal || data.pages.length > 1;
      features.push(feature);
    });

    log('Total unique features found: ' + features.length + ' (after deduplication)');

    return {
      features,
      loginSuccess,
      pagesAnalyzed: urls.length,
      logs: logs
    };

  } catch (error) {
    log('Script error: ' + error.message);
    return {
      error: error.message,
      features: [],
      loginSuccess: false,
      logs: logs
    };
  }
};
`;
}

function generateTestCasesFromFeatures(features) {
  const tests = [];

  console.log(`Generating tests from ${features.length} deduplicated features`);

  features.forEach(feature => {
    const pages = feature.appearsOnPages || [feature.pageUrl];
    const isGlobal = feature.isGlobal || pages.length > 1;

    if (feature.type === 'form') {
      const testCase = {
        title: `Test ${feature.purpose}`,
        preconditions: isGlobal
          ? `User is authenticated on the website`
          : `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: isGlobal
          ? [
              `Navigate to any page with the form (e.g., ${pages[0]})`,
              `Locate the ${feature.purpose.toLowerCase()}`,
              ...feature.inputs.slice(0, 5).map(input =>
                `Fill in "${input.name || input.type}" field with valid test data`
              ),
              'Submit the form'
            ]
          : [
              `Navigate to ${feature.pageUrl}`,
              `Locate the ${feature.purpose.toLowerCase()}`,
              ...feature.inputs.slice(0, 5).map(input =>
                `Fill in "${input.name || input.type}" field with valid test data`
              ),
              'Submit the form'
            ],
        expectedResults: `Form should be submitted successfully and appropriate feedback should be displayed`,
        priority: feature.formType === 'login' || feature.formType === 'registration' ? 'High' : 'Medium',
        category: feature.formType === 'login' ? 'Authentication' :
                  feature.formType === 'registration' ? 'User Management' :
                  feature.formType === 'search' ? 'Search' : 'Forms',
        scope: isGlobal ? 'Global' : 'Page-specific',
        affectedPages: pages
      };
      tests.push(testCase);

    } else if (feature.type === 'button') {
      if (tests.length >= 30) return;

      tests.push({
        title: `Test "${feature.text}" button functionality`,
        preconditions: isGlobal
          ? `User is authenticated on the website`
          : `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: isGlobal
          ? [
              `Navigate to any page with the button (e.g., ${pages[0]})`,
              `Locate the "${feature.text}" button`,
              'Click the button',
              'Verify the action completes'
            ]
          : [
              `Navigate to ${feature.pageUrl}`,
              `Locate the "${feature.text}" button`,
              'Click the button',
              'Verify the action completes'
            ],
        expectedResults: 'Button should trigger appropriate action and provide user feedback',
        priority: 'Medium',
        category: 'User Interaction',
        scope: isGlobal ? 'Global' : 'Page-specific',
        affectedPages: pages
      });

    } else if (feature.type === 'link') {
      if (tests.length >= 40) return;

      tests.push({
        title: `Test "${feature.text}" navigation`,
        preconditions: isGlobal
          ? `User is authenticated on the website`
          : `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: isGlobal
          ? [
              `Navigate to any page with the link (e.g., ${pages[0]})`,
              `Click on "${feature.text}" link`,
              'Verify navigation completes'
            ]
          : [
              `Navigate to ${feature.pageUrl}`,
              `Click on "${feature.text}" link`,
              'Verify navigation completes'
            ],
        expectedResults: `Should navigate to the correct destination`,
        priority: 'Low',
        category: 'Navigation',
        scope: isGlobal ? 'Global' : 'Page-specific',
        affectedPages: pages
      });
    }
  });

  return tests.slice(0, 50);
}

app.post('/analyze', async (req, res) => {
  req.setTimeout(120000);

  try {
    console.log('=== RECEIVED REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { url, urls = [], loginConfig } = req.body;
    console.log('Extracted - url:', url, 'urls:', urls, 'urls.length:', urls?.length);

    if (!url && (!urls || urls.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'URL or URLs array is required'
      });
    }

    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN not configured'
      });
    }

    const targetUrls = urls && urls.length > 0 ? urls : [url];
    console.log(`=== ANALYZING ${targetUrls.length} PAGE(S) WITH DEDUPLICATION ===`);
    console.log('Target URLs:', targetUrls);

    if (loginConfig) {
      console.log(`Login config provided for: ${loginConfig.loginUrl}`);
      console.log(`Login config details:`, JSON.stringify({
        hasUsername: !!(loginConfig.username || loginConfig.testUsername),
        hasPassword: !!(loginConfig.password || loginConfig.testPassword),
        loginUrl: loginConfig.loginUrl
      }));
    }

    const cdpUrl = getCDPWebSocketUrl();
    const script = getAnalysisScript();

    const response = await fetch(`https://production-sfo.browserless.io/function?token=${BROWSERLESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        code: script,
        context: {
          url: targetUrls[0],
          urls: targetUrls,
          loginConfig
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Browserless error:', errorText);
      return res.status(500).json({
        success: false,
        message: `Analysis failed: ${response.statusText}`
      });
    }

    const result = await response.json();
    console.log('✓ Script executed successfully');
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.error) {
      return res.status(400).json({
        success: false,
        message: result.error,
        logs: result.logs
      });
    }

    console.log('✓ Generated ' + result.features.length + ' unique features (deduplicated)');
    const tests = generateTestCasesFromFeatures(result.features);
    console.log('✓ Generated ' + tests.length + ' test cases');

    res.json({
      success: true,
      tests: tests,
      pagesAnalyzed: result.pagesAnalyzed,
      loginSuccess: result.loginSuccess,
      logs: result.logs,
      deduplicationStats: {
        uniqueFeatures: result.features.length,
        globalElements: result.features.filter(f => f.isGlobal).length,
        pageSpecificElements: result.features.filter(f => !f.isGlobal).length
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Analysis failed'
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Playwright Test Generator (Deduplicated) running on port ${PORT}`);
  console.log(`Browserless token configured: ${!!BROWSERLESS_TOKEN ? 'Yes' : 'No'}`);
  console.log('Features: Login automation, JavaScript execution, multi-page analysis, smart deduplication');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
