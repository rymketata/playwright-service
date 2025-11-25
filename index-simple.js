const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '10mb' }));

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Playwright Test Generator (Simplified)',
    version: '3.0.0',
    browserlessConfigured: !!BROWSERLESS_TOKEN
  });
});

console.log('Playwright Test Generator (Simplified) running on port', PORT);
console.log('Browserless token configured:', !!BROWSERLESS_TOKEN);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

app.post('/analyze', async (req, res) => {
  try {
    console.log('=== RECEIVED REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { url, urls, loginConfig } = req.body;
    const targetUrls = urls || [url];

    console.log('Target URLs:', targetUrls);

    if (!BROWSERLESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'BROWSERLESS_TOKEN not configured'
      });
    }

    // Use Browserless /content API - much simpler!
    const allFeatures = [];

    for (let i = 0; i < targetUrls.length; i++) {
      const targetUrl = targetUrls[i];
      console.log(`Fetching page ${i + 1}/${targetUrls.length}: ${targetUrl}`);

      const response = await fetch(`https://production-sfo.browserless.io/content?token=${BROWSERLESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          gotoOptions: {
            waitUntil: 'networkidle0',
            timeout: 30000
          }
        })
      });

      if (!response.ok) {
        console.error(`Failed to fetch ${targetUrl}:`, response.statusText);
        continue;
      }

      const html = await response.text();
      console.log(`✓ Fetched ${html.length} bytes from ${targetUrl}`);

      // Parse HTML and extract features
      const features = extractFeaturesFromHTML(html, targetUrl);
      console.log(`Found ${features.length} features on page ${i + 1}`);

      allFeatures.push(...features);
    }

    // Deduplicate features
    const uniqueFeatures = deduplicateFeatures(allFeatures);
    console.log(`Total unique features: ${uniqueFeatures.length} (from ${allFeatures.length} total)`);

    // Generate test cases
    const tests = generateTestCases(uniqueFeatures);
    console.log(`✓ Generated ${tests.length} test cases`);

    res.json({
      success: true,
      tests,
      pagesAnalyzed: targetUrls.length,
      loginSuccess: false, // Login not implemented yet in this version
      stats: {
        totalFeatures: allFeatures.length,
        uniqueFeatures: uniqueFeatures.length,
        tests: tests.length
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

function extractFeaturesFromHTML(html, url) {
  const features = [];

  // Simple regex-based extraction (no JSDOM needed)

  // Extract links
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].trim();
    if (text && !href.startsWith('javascript:') && !href.startsWith('#')) {
      features.push({
        type: 'link',
        text: text.substring(0, 100),
        selector: `a[href="${href}"]`,
        url,
        fingerprint: `link:${text}:${href}`
      });
    }
  }

  // Extract buttons
  const buttonRegex = /<button[^>]*>([^<]+)<\/button>/gi;
  while ((match = buttonRegex.exec(html)) !== null) {
    const text = match[1].trim();
    if (text) {
      features.push({
        type: 'button',
        text: text.substring(0, 100),
        selector: `button:contains("${text}")`,
        url,
        fingerprint: `button:${text}`
      });
    }
  }

  // Extract inputs
  const inputRegex = /<input[^>]+type=["']([^"']+)["'][^>]*>/gi;
  while ((match = inputRegex.exec(html)) !== null) {
    const type = match[1];
    const nameMatch = match[0].match(/name=["']([^"']+)["']/);
    const name = nameMatch ? nameMatch[1] : 'unnamed';
    features.push({
      type: 'input',
      text: `Input ${type}: ${name}`,
      selector: `input[name="${name}"]`,
      url,
      fingerprint: `input:${type}:${name}`
    });
  }

  return features;
}

function deduplicateFeatures(features) {
  const seen = new Set();
  const unique = [];

  for (const feature of features) {
    if (!seen.has(feature.fingerprint)) {
      seen.add(feature.fingerprint);
      unique.push(feature);
    }
  }

  return unique;
}

function generateTestCases(features) {
  return features.map((feature, index) => ({
    id: `test_${index + 1}`,
    title: `Test ${feature.type}: ${feature.text}`,
    description: `Verify that ${feature.type} "${feature.text}" is functional`,
    priority: 'medium',
    type: feature.type,
    selector: feature.selector,
    action: feature.type === 'link' ? 'click' : feature.type === 'button' ? 'click' : 'fill',
    expected: feature.type === 'link' ? 'Navigation occurs' : 'Element responds',
    scope: 'Page-specific',
    affectedPages: [feature.url]
  }));
}
