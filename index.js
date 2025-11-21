import express from 'express';
import cors from 'cors';
import { JSDOM } from 'jsdom';

const app = express();
const PORT = process.env.PORT || 3001;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Playwright Test Generator (HTTP)',
    version: '2.0.0',
    browserlessConfigured: !!BROWSERLESS_TOKEN,
    method: 'HTTP API'
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

    console.log('Testing Browserless HTTP API...');
    console.log('Token length:', BROWSERLESS_TOKEN.length);

    const apiUrl = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_TOKEN}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        gotoOptions: {
          waitUntil: 'networkidle0',
          timeout: 20000
        }
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Browserless API error:', response.status, errorText);
      return res.status(500).json({
        success: false,
        message: `Browserless API returned ${response.status}: ${errorText}`,
        hint: 'Check your token at https://www.browserless.io/dashboard'
      });
    }

    const html = await response.text();
    console.log(`✓ Successfully loaded page (${html.length} bytes)`);

    res.json({
      success: true,
      message: 'Browserless HTTP API connection successful',
      htmlSize: html.length
    });
  } catch (error) {
    console.error('Test failed:', error.message);
    res.status(500).json({
      success: false,
      message: `Connection test failed: ${error.message}`,
      hint: 'Verify your BROWSERLESS_TOKEN at https://www.browserless.io/dashboard'
    });
  }
});

app.post('/analyze', async (req, res) => {
  req.setTimeout(100000);

  try {
    const { url, loginConfig } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN not configured'
      });
    }

    console.log(`Analyzing website: ${url}`);

    const apiUrl = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_TOKEN}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        gotoOptions: {
          waitUntil: 'networkidle0',
          timeout: 30000
        }
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Browserless API error:', response.status, errorText);
      return res.status(500).json({
        success: false,
        message: `Failed to load page: ${response.status} - ${errorText}`
      });
    }

    const html = await response.text();
    console.log(`✓ Page loaded successfully (${html.length} bytes)`);

    const dom = new JSDOM(html);
    const document = dom.window.document;

    const features = detectFeaturesFromDOM(document, url);
    console.log(`Found ${features.length} features`);

    if (features.length === 0) {
      return res.json({
        success: false,
        message: "No functional elements detected. No tests generated."
      });
    }

    const tests = generateTestCasesFromFeatures(features);
    console.log(`✓ Generated ${tests.length} test cases`);

    res.json({
      success: true,
      tests
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Analysis failed'
    });
  }
});

function detectFeaturesFromDOM(document, pageUrl) {
  const features = [];

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

    const fieldNames = inputDetails.map(i => `${i.name} ${i.placeholder}`.toLowerCase()).join(' ');

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

  const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
  buttons.forEach((button, index) => {
    if (index >= 10) return;

    const text = button.textContent?.trim() || button.getAttribute('value') || '';
    if (text.length > 0 && text.length < 50) {
      features.push({
        type: 'button',
        text,
        pageUrl
      });
    }
  });

  const links = document.querySelectorAll('a[href]');
  links.forEach((link, index) => {
    if (index >= 10) return;

    const href = link.getAttribute('href');
    const text = link.textContent?.trim() || '';

    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && text.length > 0) {
      features.push({
        type: 'link',
        text,
        href,
        pageUrl
      });
    }
  });

  return features;
}

function generateTestCasesFromFeatures(features) {
  const tests = [];

  features.forEach(feature => {
    if (feature.type === 'form') {
      const testCase = {
        title: `Test ${feature.purpose}`,
        preconditions: `User is on ${new URL(feature.pageUrl).hostname}`,
        steps: [
          `Navigate to ${feature.pageUrl}`,
          `Locate the ${feature.purpose.toLowerCase()}`,
          ...feature.inputs.map(input =>
            `Fill in ${input.name || input.type} field with valid test data`
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
    } else if (feature.type === 'button' && tests.length < 20) {
      tests.push({
        title: `Test "${feature.text}" button functionality`,
        preconditions: `User is on ${new URL(feature.pageUrl).hostname}`,
        steps: [
          `Navigate to ${feature.pageUrl}`,
          `Locate the "${feature.text}" button`,
          'Click the button'
        ],
        expectedResults: 'Button should trigger appropriate action and provide user feedback',
        priority: 'Medium',
        category: 'Navigation'
      });
    } else if (feature.type === 'link' && tests.length < 25) {
      tests.push({
        title: `Test "${feature.text}" navigation link`,
        preconditions: `User is on ${new URL(feature.pageUrl).hostname}`,
        steps: [
          `Navigate to ${feature.pageUrl}`,
          `Click on "${feature.text}" link`
        ],
        expectedResults: `Should navigate to the correct destination`,
        priority: 'Low',
        category: 'Navigation'
      });
    }
  });

  return tests.slice(0, 30);
}

const server = app.listen(PORT, () => {
  console.log(`Playwright Test Generator service (HTTP) running on port ${PORT}`);
  console.log(`Browserless token configured: ${!!BROWSERLESS_TOKEN ? 'Yes' : 'No'}`);
  console.log('Using HTTP API (more reliable than WebSocket)');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
