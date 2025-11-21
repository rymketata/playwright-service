import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Playwright Test Generator (Chromium API)',
    version: '3.0.0',
    browserlessConfigured: !!BROWSERLESS_TOKEN,
    method: 'Chromium API with full Playwright'
  });
});

app.get('/test-connection', async (req, res) => {
  try {
    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN not configured'
      });
    }

    console.log('Testing Browserless Chromium API...');

    const script = `
      export default async ({ page }) => {
        await page.goto('https://example.com');
        const title = await page.title();
        const content = await page.content();
        return { title, contentLength: content.length };
      };
    `;

    const apiUrl = `https://production-sfo.browserless.io/chromium/function?token=${BROWSERLESS_TOKEN}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/javascript',
      },
      body: script,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Browserless API error:', response.status, errorText);
      return res.status(500).json({
        success: false,
        message: `Browserless API returned ${response.status}: ${errorText}`
      });
    }

    const result = await response.json();
    console.log(`✓ Successfully loaded page, title: ${result.title}`);

    res.json({
      success: true,
      message: 'Browserless Chromium API connection successful',
      result: result
    });
  } catch (error) {
    console.error('Test failed:', error.message);
    res.status(500).json({
      success: false,
      message: `Connection test failed: ${error.message}`
    });
  }
});

app.post('/analyze', async (req, res) => {
  req.setTimeout(120000);

  try {
    const { url, urls = [], loginConfig } = req.body;

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
    console.log(`Analyzing ${targetUrls.length} page(s)`);

    if (loginConfig) {
      console.log(`Login config provided for: ${loginConfig.loginUrl}`);
      console.log(`Login config details:`, JSON.stringify({
        hasUsername: !!loginConfig.username,
        hasPassword: !!loginConfig.password,
        loginUrl: loginConfig.loginUrl
      }));
    } else {
      console.log('No login config provided');
    }

    // Build the Playwright script
    const script = buildPlaywrightScript(targetUrls, loginConfig);

    const apiUrl = `https://production-sfo.browserless.io/chromium/function?token=${BROWSERLESS_TOKEN}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/javascript',
      },
      body: script,
      signal: AbortSignal.timeout(90000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Browserless API error:', response.status, errorText);
      return res.status(500).json({
        success: false,
        message: `Failed to execute script: ${response.status} - ${errorText}`
      });
    }

    const result = await response.json();
    console.log(`✓ Script executed successfully`);
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.error) {
      console.error('Script execution error:', result.error);
      return res.status(500).json({
        success: false,
        message: result.error,
        debug: result
      });
    }

    if (!result.features || result.features.length === 0) {
      console.log('⚠️ No features found');
      console.log('Login success:', result.loginSuccess);
      console.log('Pages analyzed:', result.pagesAnalyzed);
      console.log('Logs:', result.logs);
      return res.json({
        success: false,
        message: "No functional elements detected after JavaScript execution.",
        debug: {
          loginSuccess: result.loginSuccess,
          pagesAnalyzed: result.pagesAnalyzed,
          logs: result.logs,
          fullResult: result
        }
      });
    }

    const tests = generateTestCasesFromFeatures(result.features);
    console.log(`✓ Generated ${tests.length} test cases`);

    res.json({
      success: true,
      tests,
      loginSuccess: result.loginSuccess,
      pagesAnalyzed: result.pagesAnalyzed
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Analysis failed'
    });
  }
});

function buildPlaywrightScript(urls, loginConfig) {
  const urlsJson = JSON.stringify(urls);
  const loginJson = JSON.stringify(loginConfig || null);

  return `
export default async ({ page }) => {
  const urls = ${urlsJson};
  const loginConfig = ${loginJson};
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

      // Try to find and fill login form with multilingual support
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

        // Find and click submit button with multilingual support
        // Including div/span for React Native Web and modern frameworks
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Login")',
          'button:has-text("Log in")',
          'button:has-text("Sign in")',
          'button:has-text("Se connecter")',
          'button:has-text("Connexion")',
          'button:has-text("Entrer")',
          'button:has-text("Valider")',
          'button[value*="login" i]',
          'button[value*="connexion" i]',
          'input[value*="login" i]',
          'input[value*="connexion" i]',
          // React Native Web, Vue.js, and other frameworks using div/span
          'div[role="button"]:has-text("Se connecter")',
          'div[role="button"]:has-text("Connexion")',
          'div[role="button"]:has-text("Login")',
          'div[role="button"]:has-text("Sign in")',
          'div[tabindex="0"]:has-text("Se connecter")',
          'div[tabindex="0"]:has-text("Connexion")',
          'div[tabindex="0"]:has-text("Login")',
          'div[tabindex="0"]:has-text("Sign in")',
          'span[role="button"]:has-text("Se connecter")',
          'span[role="button"]:has-text("Login")',
          // Generic clickable elements near password fields
          'div[class*="btn"]:has-text("Se connecter")',
          'div[class*="btn"]:has-text("Login")',
          'div[class*="button"]:has-text("Se connecter")',
          'div[class*="button"]:has-text("Login")'
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

          await wait(3000);

          // Verify login success by checking for error messages or login form still present
          log('Verifying login success...');
          const loginFailed = await page.evaluate(() => {
            // Check for error messages (French and English)
            const errorSelectors = [
              'div[class*="error"]', 'span[class*="error"]', 'p[class*="error"]',
              'div[class*="alert"]', 'div[class*="danger"]', 'div[class*="invalid"]',
              'div[role="alert"]', '[aria-invalid="true"]'
            ];

            for (const selector of errorSelectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent?.toLowerCase() || '';
                // Check for common error messages
                if (text.includes('incorrect') || text.includes('invalid') || text.includes('wrong') ||
                    text.includes('failed') || text.includes('erreur') || text.includes('incorrecte') ||
                    text.includes('invalide') || text.includes('échoué') || text.includes('echec')) {
                  return { failed: true, message: el.textContent?.trim() || 'Login failed' };
                }
              }
            }

            // Check if password field is still present (usually means login failed)
            const passwordField = document.querySelector('input[type="password"]');
            const currentUrl = window.location.href;

            // If password field exists and URL contains 'login', likely still on login page
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
          // Fallback: try to find any clickable element with login/connexion text
          log('Submit button not found with standard selectors, trying generic search...');

          const genericSubmit = await page.evaluate(() => {
            const elements = document.querySelectorAll('button, div[role="button"], div[tabindex="0"], span[role="button"], a, div[class*="btn"], div[class*="button"]');
            for (const el of elements) {
              const text = el.textContent?.toLowerCase() || '';
              if (text.includes('connect') || text.includes('login') || text.includes('sign in') ||
                  text.includes('entrer') || text.includes('valider')) {
                return true;
              }
            }
            return false;
          });

          if (genericSubmit) {
            log('Found generic clickable element, clicking...');
            await page.evaluate(() => {
              const elements = document.querySelectorAll('button, div[role="button"], div[tabindex="0"], span[role="button"], a, div[class*="btn"], div[class*="button"]');
              for (const el of elements) {
                const text = el.textContent?.toLowerCase() || '';
                if (text.includes('connect') || text.includes('login') || text.includes('sign in') ||
                    text.includes('entrer') || text.includes('valider')) {
                  el.click();
                  return;
                }
              }
            });
            await wait(3000);
            log('Login submitted via generic element');
          } else {
            log('No submit button found, pressing Enter...');
            await passwordInput.press('Enter');
            await wait(3000);
            log('Login submitted via Enter key');
          }

          // Verify login success for fallback methods too
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
        }
      } else {
        log('Login form not found - username: ' + !!usernameInput + ', password: ' + !!passwordInput);
        return { error: 'Login form not found on the page', features: [], loginSuccess: false, logs: logs };
      }
    }

    // Step 2: Analyze each URL
    for (let i = 0; i < urls.length; i++) {
      const targetUrl = urls[i];
      log('Analyzing page ' + (i + 1) + '/' + urls.length + ': ' + targetUrl);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await wait(2000);
        log('Page loaded, extracting elements...');

        // Extract elements after JavaScript execution
        const pageFeatures = await page.evaluate((pageUrl) => {
          const features = [];

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

            const fieldNames = inputDetails.map(i => \`\${i.name} \${i.placeholder}\`.toLowerCase()).join(' ');

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

            features.push({
              type: 'form',
              formType,
              purpose: formPurpose,
              inputs: inputDetails,
              pageUrl
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
              features.push({
                type: 'button',
                text: displayText,
                pageUrl
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
              features.push({
                type: 'link',
                text,
                href,
                pageUrl
              });
            }
          });

          return features;
        }, targetUrl);

        log('Found ' + pageFeatures.length + ' features on ' + targetUrl);
        features.push(...pageFeatures);

      } catch (error) {
        log('Error analyzing ' + targetUrl + ': ' + error.message);
      }
    }

    log('Total features found: ' + features.length);

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
  const seen = new Set();

  features.forEach(feature => {
    if (feature.type === 'form') {
      const key = `form-${feature.purpose}-${feature.pageUrl}`;
      if (seen.has(key)) return;
      seen.add(key);

      const testCase = {
        title: `Test ${feature.purpose}`,
        preconditions: `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: [
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
                  feature.formType === 'search' ? 'Search' : 'Forms'
      };
      tests.push(testCase);
    } else if (feature.type === 'button') {
      const key = `button-${feature.text}-${feature.pageUrl}`;
      if (seen.has(key) || tests.length >= 30) return;
      seen.add(key);

      tests.push({
        title: `Test "${feature.text}" button functionality`,
        preconditions: `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: [
          `Navigate to ${feature.pageUrl}`,
          `Locate the "${feature.text}" button`,
          'Click the button',
          'Verify the action completes'
        ],
        expectedResults: 'Button should trigger appropriate action and provide user feedback',
        priority: 'Medium',
        category: 'User Interaction'
      });
    } else if (feature.type === 'link') {
      const key = `link-${feature.text}-${feature.pageUrl}`;
      if (seen.has(key) || tests.length >= 40) return;
      seen.add(key);

      tests.push({
        title: `Test "${feature.text}" navigation`,
        preconditions: `User is authenticated and on ${new URL(feature.pageUrl).pathname}`,
        steps: [
          `Navigate to ${feature.pageUrl}`,
          `Click on "${feature.text}" link`,
          'Verify navigation completes'
        ],
        expectedResults: `Should navigate to the correct destination`,
        priority: 'Low',
        category: 'Navigation'
      });
    }
  });

  return tests.slice(0, 50);
}

const server = app.listen(PORT, () => {
  console.log(`Playwright Test Generator (Chromium API) running on port ${PORT}`);
  console.log(`Browserless token configured: ${!!BROWSERLESS_TOKEN ? 'Yes' : 'No'}`);
  console.log('Using Chromium API with full Playwright support');
  console.log('Features: Login automation, JavaScript execution, multi-page analysis');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
