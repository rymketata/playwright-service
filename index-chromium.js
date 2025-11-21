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

  try {
    // Step 1: Handle login if credentials provided
    if (loginConfig && loginConfig.loginUrl && loginConfig.username && loginConfig.password) {
      console.log('Navigating to login page:', loginConfig.loginUrl);
      await page.goto(loginConfig.loginUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Try to find and fill login form
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[placeholder*="username" i]',
        'input[placeholder*="email" i]',
        'input[id*="username" i]',
        'input[id*="email" i]'
      ];

      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        'input[id*="password" i]'
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
        await usernameInput.type(loginConfig.username);
        await passwordInput.type(loginConfig.password);

        // Find and click submit button
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Login")',
          'button:has-text("Sign in")',
          'button:has-text("Se connecter")'
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
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
            submitButton.click()
          ]);

          await page.waitForTimeout(3000);
          loginSuccess = true;
          console.log('Login completed');
        } else {
          console.log('Submit button not found, pressing Enter...');
          await passwordInput.press('Enter');
          await page.waitForTimeout(3000);
          loginSuccess = true;
        }
      } else {
        console.log('Login form not found');
        return { error: 'Login form not found on the page', features: [], loginSuccess: false };
      }
    }

    // Step 2: Analyze each URL
    for (let i = 0; i < urls.length; i++) {
      const targetUrl = urls[i];
      console.log(\`Analyzing page \${i + 1}/\${urls.length}: \${targetUrl}\`);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForTimeout(2000);

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

        console.log(\`Found \${pageFeatures.length} features on \${targetUrl}\`);
        features.push(...pageFeatures);

      } catch (error) {
        console.error(\`Error analyzing \${targetUrl}:\`, error.message);
      }
    }

    console.log(\`Total features found: \${features.length}\`);

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
