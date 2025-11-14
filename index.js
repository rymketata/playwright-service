import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright-core';

const app = express();
const PORT = process.env.PORT || 3001;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Playwright Test Generator',
    version: '1.0.0'
  });
});

app.post('/analyze', async (req, res) => {
  let browser;

  try {
    const { url, loginConfig } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    console.log(`Analyzing website: ${url}`);

    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN environment variable is not configured'
      });
    }

    const wsEndpoint = `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}`;
    console.log('Connecting to Browserless.io...');
    browser = await chromium.connect(wsEndpoint);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);

    if (loginConfig && loginConfig.loginUrl) {
      console.log('Login credentials provided, attempting authentication...');

      await page.goto(loginConfig.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1000);

      const usernameInput = await page.locator(`input[name="${loginConfig.usernameField}"], input[id="${loginConfig.usernameField}"]`).first();
      const passwordInput = await page.locator(`input[name="${loginConfig.passwordField}"], input[id="${loginConfig.passwordField}"]`).first();

      if (await usernameInput.count() === 0 || await passwordInput.count() === 0) {
        await browser.close();
        return res.json({
          success: false,
          message: "Login failed or page not accessible. No tests generated.",
        });
      }

      await usernameInput.fill(loginConfig.testUsername);
      await passwordInput.fill(loginConfig.testPassword);

      const submitButton = await page.locator('button[type="submit"], input[type="submit"]').first();
      await submitButton.click();

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const currentUrl = page.url();
      const hasErrorMessage = await page.locator('text=/error|invalid|incorrect|failed|wrong/i').count() > 0;

      if (hasErrorMessage || currentUrl === loginConfig.loginUrl) {
        await browser.close();
        return res.json({
          success: false,
          message: "Login failed or page not accessible. No tests generated.",
        });
      }

      console.log('Login successful, analyzing authenticated pages...');
    }

    const allPages = [page.url()];
    const links = await page.locator('a[href]').evaluateAll(
      (elements) => elements
        .map(el => el.getAttribute('href'))
        .filter(href => href && !href.startsWith('#') && !href.startsWith('javascript:'))
        .slice(0, 5)
    );

    for (const link of links) {
      try {
        const absoluteUrl = new URL(link, page.url()).href;
        if (!allPages.includes(absoluteUrl)) {
          allPages.push(absoluteUrl);
        }
      } catch (e) {
        console.log(`Invalid URL: ${link}`);
      }
    }

    const allFeatures = [];

    for (const pageUrl of allPages.slice(0, 3)) {
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1000);
        const features = await detectFeaturesFromPage(page);
        allFeatures.push(...features.map(f => ({ ...f, pageUrl })));
      } catch (e) {
        console.log(`Failed to analyze page: ${pageUrl}`);
      }
    }

    await browser.close();

    if (allFeatures.length === 0) {
      return res.json({
        success: false,
        message: "No functional elements detected. No tests generated.",
      });
    }

    const tests = generateTestCasesFromFeatures(allFeatures);

    res.json({
      success: true,
      tests,
    });

  } catch (error) {
    console.error('Analysis error:', error);
    if (browser) {
      await browser.close().catch(err => console.error('Error closing browser:', err));
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Analysis failed',
    });
  }
});

async function detectFeaturesFromPage(page) {
  const features = [];

  const forms = await page.locator('form').count();
  const maxForms = Math.min(forms, 5);
  for (let i = 0; i < maxForms; i++) {
    const form = page.locator('form').nth(i);
    const action = await form.getAttribute('action') || '';
    const method = await form.getAttribute('method') || 'GET';

    const inputs = await form.locator('input, select, textarea').evaluateAll(
      (elements) => elements.map(el => ({
        name: el.getAttribute('name') || el.getAttribute('id') || '',
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        placeholder: el.getAttribute('placeholder') || '',
        label: el.closest('label')?.textContent?.trim() || '',
      }))
    );

    if (inputs.length > 0) {
      const fieldNames = inputs.map(i => `${i.name} ${i.placeholder} ${i.label}`.toLowerCase()).join(' ');

      let formType = 'data-entry';
      let formPurpose = 'Data Entry Form';

      if (fieldNames.includes('email') && fieldNames.includes('password') && !fieldNames.includes('confirm')) {
        formType = 'login';
        formPurpose = 'Login Form';
      } else if (fieldNames.includes('search') || fieldNames.includes('query')) {
        formType = 'search';
        formPurpose = 'Search Form';
      } else if (fieldNames.includes('card') || fieldNames.includes('payment') || fieldNames.includes('cvv')) {
        formType = 'payment';
        formPurpose = 'Payment Form';
      } else if (fieldNames.includes('register') || fieldNames.includes('signup') || (fieldNames.includes('email') && fieldNames.includes('confirm'))) {
        formType = 'registration';
        formPurpose = 'Registration Form';
      } else if (fieldNames.includes('comment') || fieldNames.includes('message') || fieldNames.includes('feedback')) {
        formType = 'feedback';
        formPurpose = 'Feedback Form';
      }

      features.push({
        type: 'form',
        subtype: formType,
        description: formPurpose,
        action,
        method,
        fields: inputs,
      });
    }
  }

  const tables = await page.locator('table').count();
  const maxTables = Math.min(tables, 3);
  for (let i = 0; i < maxTables; i++) {
    const table = page.locator('table').nth(i);
    const headers = await table.locator('th').evaluateAll(
      (elements) => elements.map(el => el.textContent?.trim() || '')
    );
    const rowCount = await table.locator('tbody tr').count();

    if (headers.length > 0 && rowCount > 0) {
      features.push({
        type: 'table',
        description: 'Data Table',
        columns: headers,
        rowCount,
      });
    }
  }

  const buttons = await page.locator('button:not([type="submit"]), a.button, [role="button"]').evaluateAll(
    (elements) => elements.map(el => ({
      text: el.textContent?.trim() || '',
      classes: el.className,
    })).filter(b => b.text && b.text.length > 0 && b.text.length < 50).slice(0, 10)
  );

  buttons.forEach(button => {
    const text = button.text.toLowerCase();
    let actionType = 'action';

    if (text.includes('add') || text.includes('create') || text.includes('new')) {
      actionType = 'create';
    } else if (text.includes('edit') || text.includes('update') || text.includes('modify')) {
      actionType = 'update';
    } else if (text.includes('delete') || text.includes('remove')) {
      actionType = 'delete';
    } else if (text.includes('export') || text.includes('download')) {
      actionType = 'export';
    } else if (text.includes('filter') || text.includes('sort')) {
      actionType = 'filter';
    }

    features.push({
      type: 'button',
      subtype: actionType,
      description: `${button.text} Button`,
      text: button.text,
    });
  });

  const navMenus = await page.locator('nav, [role="navigation"]').count();
  const maxNavs = Math.min(navMenus, 2);
  for (let i = 0; i < maxNavs; i++) {
    const nav = page.locator('nav, [role="navigation"]').nth(i);
    const links = await nav.locator('a').evaluateAll(
      (elements) => elements.map(el => ({
        text: el.textContent?.trim() || '',
        href: el.getAttribute('href') || '',
      })).filter(l => l.text)
    );

    if (links.length > 0) {
      features.push({
        type: 'navigation',
        description: 'Navigation Menu',
        links,
      });
    }
  }

  const modals = await page.locator('[role="dialog"], .modal, [class*="modal"]').count();
  if (modals > 0) {
    features.push({
      type: 'modal',
      description: 'Modal/Dialog Component',
      count: modals,
    });
  }

  return features;
}

function generateTestCasesFromFeatures(features) {
  const tests = [];

  features.forEach(feature => {
    switch (feature.type) {
      case 'form':
        tests.push(generateFormTest(feature));
        break;
      case 'table':
        tests.push(generateTableTest(feature));
        break;
      case 'button':
        if (feature.subtype === 'create') {
          tests.push(generateCreateTest(feature));
        } else if (feature.subtype === 'update') {
          tests.push(generateUpdateTest(feature));
        } else if (feature.subtype === 'delete') {
          tests.push(generateDeleteTest(feature));
        } else if (feature.subtype === 'export') {
          tests.push(generateExportTest(feature));
        } else if (feature.subtype === 'filter') {
          tests.push(generateFilterTest(feature));
        }
        break;
      case 'navigation':
        tests.push(generateNavigationTest(feature));
        break;
    }
  });

  const hasCRUD = features.some(f => f.type === 'form' && f.subtype === 'data-entry') &&
                  features.some(f => f.type === 'table') &&
                  features.some(f => f.type === 'button' && ['create', 'update', 'delete'].includes(f.subtype));

  if (hasCRUD) {
    tests.push(generateCRUDWorkflowTest(features));
  }

  return tests;
}

function generateFormTest(feature) {
  const fieldList = feature.fields.map(f => f.label || f.placeholder || f.name).filter(n => n).join(', ');

  return {
    title: `Validate ${feature.description} Submission`,
    preconditions: `User is on the page containing the ${feature.description.toLowerCase()}`,
    steps: [
      `Navigate to the form`,
      `Fill in required fields: ${fieldList}`,
      `Click submit button`,
      `Observe the response`,
    ],
    expectedResults: `Form submits successfully and user receives confirmation or is redirected to the appropriate page`,
    priority: feature.subtype === 'login' || feature.subtype === 'payment' ? 'High' : 'Medium',
    category: feature.subtype === 'login' ? 'Authentication' : feature.subtype === 'payment' ? 'Payment' : 'Forms',
  };
}

function generateTableTest(feature) {
  return {
    title: `Verify Data Table Display`,
    preconditions: `User has access to the page with the data table`,
    steps: [
      `Navigate to the page with the table`,
      `Observe the table headers: ${feature.columns.join(', ')}`,
      `Verify that data rows are displayed`,
      `Check that all ${feature.rowCount} rows are visible or paginated correctly`,
    ],
    expectedResults: `Table displays with correct headers and all data rows are accessible`,
    priority: 'Medium',
    category: 'Data Display',
  };
}

function generateCreateTest(feature) {
  return {
    title: `Verify Create Operation via ${feature.text}`,
    preconditions: `User is authenticated and has permission to create new records`,
    steps: [
      `Click on "${feature.text}" button`,
      `Fill in the required fields in the creation form`,
      `Submit the form`,
      `Verify the new record appears in the list/table`,
    ],
    expectedResults: `New record is created successfully and displayed in the data list`,
    priority: 'High',
    category: 'CRUD Operations',
  };
}

function generateUpdateTest(feature) {
  return {
    title: `Verify Update Operation via ${feature.text}`,
    preconditions: `User is authenticated and at least one record exists`,
    steps: [
      `Select an existing record`,
      `Click on "${feature.text}" button`,
      `Modify one or more fields`,
      `Save the changes`,
      `Verify the record reflects the updated information`,
    ],
    expectedResults: `Record is updated successfully with the new information`,
    priority: 'High',
    category: 'CRUD Operations',
  };
}

function generateDeleteTest(feature) {
  return {
    title: `Verify Delete Operation via ${feature.text}`,
    preconditions: `User is authenticated and at least one record exists`,
    steps: [
      `Select an existing record`,
      `Click on "${feature.text}" button`,
      `Confirm the deletion in the prompt (if any)`,
      `Verify the record is removed from the list`,
    ],
    expectedResults: `Record is deleted successfully and no longer appears in the data list`,
    priority: 'High',
    category: 'CRUD Operations',
  };
}

function generateExportTest(feature) {
  return {
    title: `Verify Data Export via ${feature.text}`,
    preconditions: `User is on a page with exportable data`,
    steps: [
      `Click on "${feature.text}" button`,
      `Wait for the export to complete`,
      `Verify the file is downloaded`,
      `Open the file and verify it contains the expected data`,
    ],
    expectedResults: `Data is exported successfully in the correct format with all expected records`,
    priority: 'Low',
    category: 'Data Export',
  };
}

function generateFilterTest(feature) {
  return {
    title: `Verify Data Filtering via ${feature.text}`,
    preconditions: `User is viewing a page with filterable data`,
    steps: [
      `Click on "${feature.text}" button or option`,
      `Select or enter filter criteria`,
      `Apply the filter`,
      `Verify that only matching records are displayed`,
    ],
    expectedResults: `Data is filtered correctly based on the selected criteria`,
    priority: 'Medium',
    category: 'Data Filtering',
  };
}

function generateNavigationTest(feature) {
  const linkNames = feature.links.map(l => l.text).join(', ');

  return {
    title: `Verify Navigation Menu Functionality`,
    preconditions: `User is on the main page`,
    steps: [
      `Locate the navigation menu`,
      `Verify all menu items are visible: ${linkNames}`,
      `Click on each menu item`,
      `Verify each link navigates to the correct page`,
    ],
    expectedResults: `All navigation links work correctly and navigate to their respective pages`,
    priority: 'High',
    category: 'Navigation',
  };
}

function generateCRUDWorkflowTest(features) {
  return {
    title: `Verify Complete CRUD Workflow`,
    preconditions: `User is authenticated with full CRUD permissions`,
    steps: [
      `Create a new record using the creation form`,
      `Verify the record appears in the data table`,
      `Edit the newly created record`,
      `Verify the changes are saved and reflected in the table`,
      `Delete the record`,
      `Verify the record is removed from the table`,
    ],
    expectedResults: `Complete CRUD workflow functions correctly: Create, Read, Update, and Delete operations all work as expected`,
    priority: 'Critical',
    category: 'End-to-End Workflow',
  };
}

app.listen(PORT, () => {
  console.log(`Playwright Test Generator service running on port ${PORT}`);
  console.log(`Browserless token configured: ${BROWSERLESS_TOKEN ? 'Yes' : 'No'}`);
});
