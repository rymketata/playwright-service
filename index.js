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
    const { url, urls = [], pages = [], loginConfig } = req.body;

    if (!url && (!urls || urls.length === 0) && (!pages || pages.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'URL or URLs/pages array is required'
      });
    }

    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN not configured'
      });
    }

    // Support both 'urls' and 'pages' parameter names
    const additionalUrls = pages.length > 0 ? pages : urls;
    let targetUrls;

    if (additionalUrls && additionalUrls.length > 0) {
      targetUrls = url ? [url, ...additionalUrls] : additionalUrls;
    } else {
      targetUrls = url ? [url] : [];
    }

    // Filter out undefined/empty values
    targetUrls = targetUrls.filter(u => u && u.trim());

    console.log(`Analyzing ${targetUrls.length} page(s):`, targetUrls);

    if (loginConfig) {
      console.log(`Login config provided for: ${loginConfig.loginUrl}`);
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

    if (result.error) {
      console.error('Script execution error:', result.error);
      return res.status(500).json({
        success: false,
        message: result.error
      });
    }

    if (!result.features || result.features.length === 0) {
      return res.json({
        success: false,
        message: "No functional elements detected after JavaScript execution.",
        debug: {
          loginSuccess: result.loginSuccess,
          pagesAnalyzed: result.pagesAnalyzed,
          screenshots: result.screenshots
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
  let loginSuccess = false;

  // Helper function for waiting
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // Step 1: Handle login if credentials provided
    const username = loginConfig?.username || loginConfig?.testUsername;
    const password = loginConfig?.password || loginConfig?.testPassword;

    if (loginConfig && loginConfig.loginUrl && username && password) {
      console.log('Navigating to login page:', loginConfig.loginUrl);
      await page.goto(loginConfig.loginUrl, { waitUntil: 'load', timeout: 30000 });
      await wait(2000);

      // Try to find and fill login form - comprehensive selectors for both French and English
      const usernameSelectors = [
        // By attribute name (most reliable)
        'input[name="username"]',
        'input[name="email"]',
        'input[name="login"]',
        'input[name="user"]',
        'input[name="identifier"]',
        // By type
        'input[type="email"]',
        // By placeholder - English
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        'input[placeholder*="user name" i]',
        'input[placeholder*="login" i]',
        // By placeholder - French
        'input[placeholder*="mail" i]',
        'input[placeholder*="utilisateur" i]',
        'input[placeholder*="identifiant" i]',
        'input[placeholder*="nom" i]',
        // By ID
        'input[id*="username" i]',
        'input[id*="email" i]',
        'input[id*="login" i]',
        'input[id*="user" i]',
        // By class
        'input[class*="email" i]',
        'input[class*="username" i]',
        'input[class*="login" i]',
        // Fallback - first text or email input in form
        'form input[type="email"]',
        'form input[type="text"]:first-of-type'
      ];

      const passwordSelectors = [
        // By attribute name
        'input[name="password"]',
        'input[name="passwd"]',
        'input[name="pwd"]',
        'input[name="pass"]',
        // By type (most reliable for password)
        'input[type="password"]',
        // By placeholder - English
        'input[placeholder*="password" i]',
        'input[placeholder*="pass" i]',
        // By placeholder - French
        'input[placeholder*="mot de passe" i]',
        'input[placeholder*="motdepasse" i]',
        // By ID
        'input[id*="password" i]',
        'input[id*="passwd" i]',
        'input[id*="pass" i]',
        // By class
        'input[class*="password" i]',
        'input[class*="passwd" i]',
        // Fallback
        'form input[type="password"]'
      ];

      let usernameInput = null;
      for (const selector of usernameSelectors) {
        try {
          usernameInput = await page.$(selector);
          if (usernameInput) {
            console.log('Found username field:', selector);
            break;
          }
        } catch (e) {}
      }

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await page.$(selector);
          if (passwordInput) {
            console.log('Found password field:', selector);
            break;
          }
        } catch (e) {}
      }

      if (usernameInput && passwordInput) {
        console.log('Filling login credentials...');
        await usernameInput.type(username);
        await passwordInput.type(password);

        // Find and click submit button - including DIVs and SPANs
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Login")',
          'button:has-text("Sign in")',
          'button:has-text("Se connecter")',
          'button:has-text("Connexion")',
          'div:has-text("Se connecter")',
          'div:has-text("Login")',
          'div:has-text("Sign in")',
          'span:has-text("Se connecter")',
          'span:has-text("Login")',
          'a:has-text("Se connecter")',
          'a:has-text("Login")'
        ];

        let submitButton = null;
        for (const selector of submitSelectors) {
          try {
            submitButton = await page.$(selector);
            if (submitButton) {
              console.log('Found submit button:', selector);
              break;
            }
          } catch (e) {}
        }

        if (submitButton) {
          console.log('Clicking login button...');
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {}),
            submitButton.click()
          ]);

          await wait(3000);
        } else {
          console.log('Submit button not found, pressing Enter...');
          await passwordInput.press('Enter');
          await wait(3000);
        }

        // Verify login success by checking for error messages
        console.log('Verifying login...');

        // Wait a bit more for potential error messages to appear
        await wait(2000);

        const loginFailed = await page.evaluate(() => {
          // Check for error messages in TWO ways:
          // 1. Elements with error-related classes
          // 2. ANY visible element containing error text

          // STEP 1: Check error-styled elements
          const errorSelectors = [
            'div[class*="error"]', 'span[class*="error"]', 'p[class*="error"]',
            'div[class*="alert"]', 'div[class*="danger"]', 'div[class*="invalid"]',
            'div[role="alert"]', '[aria-invalid="true"]',
            'span[class*="alert"]', 'p[class*="alert"]',
            'div[class*="notification"]', 'div[class*="toast"]',
            'div[class*="message"]', 'span[class*="message"]'
          ];

          for (const selector of errorSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const isVisible = rect.width > 0 && rect.height > 0 &&
                               style.display !== 'none' &&
                               style.visibility !== 'hidden' &&
                               parseFloat(style.opacity) > 0;

              if (!isVisible) continue;

              const text = el.textContent?.toLowerCase() || '';

              // Check for login error patterns
              if (text.includes('incorrect') || text.includes('invalid') ||
                  text.includes('wrong') || text.includes('failed') ||
                  text.includes('incorrecte') || text.includes('invalide') ||
                  text.includes('échoué') || text.includes('échec') ||
                  text.includes('désactivé') || text.includes('desactive')) {
                return { failed: true, message: el.textContent?.trim() || 'Login failed' };
              }
            }
          }

          // STEP 2: Search ALL visible text for common error phrases
          // This catches errors that might not be in specially-styled elements
          const allElements = document.querySelectorAll('div, span, p');
          for (const el of allElements) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && rect.height > 0 &&
                             style.display !== 'none' &&
                             style.visibility !== 'hidden' &&
                             parseFloat(style.opacity) > 0;

            if (!isVisible) continue;

            const text = el.textContent?.toLowerCase() || '';

            // Specific error phrases that indicate login failure
            const errorPhrases = [
              'email ou mot de passe incorrect',
              'identifiants incorrects',
              'compte désactivé',
              'invalid credentials',
              'incorrect password',
              'login failed',
              'authentication failed',
              'échec de connexion',
              'connexion échouée'
            ];

            for (const phrase of errorPhrases) {
              if (text.includes(phrase)) {
                return { failed: true, message: el.textContent?.trim() || 'Login failed' };
              }
            }
          }

          // No error found - assume success
          return { failed: false, message: 'No error detected' };
        });

        if (loginFailed.failed) {
          console.log('Login failed: ' + loginFailed.message);
          return {
            error: 'Login failed: ' + loginFailed.message + '. Please verify your credentials.',
            features: [],
            loginSuccess: false,
            pagesAnalyzed: 0
          };
        }

        loginSuccess = true;
        console.log('Login verified successfully');
      } else {
        console.log('Login form not found');
        return { error: 'Login form not found on the page', features: [], loginSuccess: false };
      }
    }

    // Step 2: Analyze each URL
    for (let i = 0; i < urls.length; i++) {
      const targetUrl = urls[i];
      console.log('Analyzing page ' + (i + 1) + '/' + urls.length + ': ' + targetUrl);

      try {
        // Navigate with multiple wait strategies (fallback if networkidle fails)
        try {
          await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (e) {
          console.log('networkidle failed, falling back to domcontentloaded...');
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        console.log('Page loaded, waiting for dynamic content...');

        // Wait for common framework indicators
        await Promise.race([
          page.waitForSelector('button, [role="button"], a, input, form', { timeout: 5000 }),
          wait(5000)
        ]).catch(() => {});

        // Additional wait for animations and transitions
        await wait(3000);

        console.log('Starting element extraction...');

        // Extract elements after JavaScript execution - with retry logic
        let pageFeatures = [];
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts && pageFeatures.length === 0) {
          attempts++;
          console.log('Extraction attempt ' + attempts + '/' + maxAttempts);

          pageFeatures = await page.evaluate((pageUrl) => {
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

            const fieldNames = inputDetails.map(i => (i.name + ' ' + i.placeholder).toLowerCase()).join(' ');

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

          // Virtual Forms (no <form> tag) - Detect grouped inputs
          // This handles modern React/Vue SPAs that don't use <form> tags
          const allInputs = document.querySelectorAll('input[type="email"], input[type="text"], input[type="password"]');
          const inputsOutsideForms = Array.from(allInputs).filter(input => !input.closest('form'));

          if (inputsOutsideForms.length >= 2) {
            // Check if we have email + password combination (login form)
            const hasEmail = inputsOutsideForms.some(input =>
              input.type === 'email' ||
              (input.placeholder || '').toLowerCase().includes('email') ||
              (input.placeholder || '').toLowerCase().includes('e-mail') ||
              (input.placeholder || '').toLowerCase().includes('mail')
            );

            const hasPassword = inputsOutsideForms.some(input =>
              input.type === 'password' ||
              (input.placeholder || '').toLowerCase().includes('password') ||
              (input.placeholder || '').toLowerCase().includes('mot de passe')
            );

            if (hasEmail && hasPassword && forms.length === 0) {
              // This is a virtual login form
              const inputDetails = inputsOutsideForms.map(el => ({
                name: el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || '',
                type: el.getAttribute('type') || 'text',
                placeholder: el.getAttribute('placeholder') || '',
              }));

              features.push({
                type: 'form',
                formType: 'login',
                purpose: 'Login Form (Virtual)',
                inputs: inputDetails,
                pageUrl
              });
              console.log('✓ Detected virtual login form (no <form> tag)');
            }
          }

          // Buttons and clickable elements - COMPREHENSIVE detection
          const buttons = document.querySelectorAll(
            'button, input[type="button"], input[type="submit"], ' +
            '[role="button"], [onclick], ' +
            'div[class*="button" i], div[class*="btn" i], ' +
            'span[class*="button" i], span[class*="btn" i], ' +
            'a[class*="button" i], a[class*="btn" i], ' +
            '[class*="clickable" i], [class*="action" i]'
          );

          const seenButtons = new Set();
          buttons.forEach((button, index) => {
            if (index >= 30) return;

            // Get text from multiple sources
            const text = button.textContent?.trim() || button.getAttribute('value') || button.getAttribute('title') || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            const displayText = (text || ariaLabel).trim();

            // Skip duplicates and invalid entries
            if (displayText.length > 0 && displayText.length < 150 && !seenButtons.has(displayText)) {
              seenButtons.add(displayText);
              features.push({
                type: 'button',
                text: displayText,
                pageUrl
              });
            }
          });

          // Links - improved detection
          const links = document.querySelectorAll('a[href]');
          const seenLinks = new Set();
          links.forEach((link, index) => {
            if (index >= 25) return;

            const href = link.getAttribute('href');
            const text = link.textContent?.trim() || link.getAttribute('title') || '';

            if (href && !href.startsWith('#') && !href.startsWith('javascript:') &&
                text.length > 0 && text.length < 100 && !seenLinks.has(text)) {
              seenLinks.add(text);
              features.push({
                type: 'link',
                text,
                href,
                pageUrl
              });
            }
          });

          // Debug: Count each type
          const formCount = features.filter(f => f.type === 'form').length;
          const buttonCount = features.filter(f => f.type === 'button').length;
          const linkCount = features.filter(f => f.type === 'link').length;

          console.log('Found - Forms: ' + formCount + ', Buttons: ' + buttonCount + ', Links: ' + linkCount);

          return features;
          }, targetUrl);

          console.log('Attempt ' + attempts + ': Found ' + pageFeatures.length + ' features');

          // If no features found, wait and retry
          if (pageFeatures.length === 0 && attempts < maxAttempts) {
            console.log('No features found, waiting before retry...');
            await wait(2000);
          }
        }

        console.log('Total found ' + pageFeatures.length + ' features on ' + targetUrl);
        features.push(...pageFeatures);

      } catch (error) {
        console.error('Error analyzing ' + targetUrl + ':', error.message);
      }
    }

    console.log('Total features found: ' + features.length);

    return {
      features,
      loginSuccess,
      pagesAnalyzed: urls.length
    };

  } catch (error) {
    console.error('Script error:', error.message);
    return {
      error: error.message,
      features: [],
      loginSuccess: false
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
