# Playwright Test Generator Service

A standalone Node.js service that uses Playwright and Browserless.io to analyze websites and generate test cases.

## Features

- Browser-based website analysis with login support
- Automatic detection of forms, tables, buttons, and navigation
- Generates comprehensive test cases with steps and expected results
- Free-tier compatible with Render, Railway, and Fly.io

## Prerequisites

1. **Browserless.io Account** (Free tier available)
   - Sign up at [browserless.io](https://www.browserless.io/)
   - Get your API token from the dashboard
   - Note: Service uses the new endpoint `wss://production-sfo.browserless.io`

## Deployment

### Option 1: Deploy to Render (Recommended for Free Tier)

1. Push this `playwright-service` folder to a Git repository
2. Go to [render.com](https://render.com/) and sign up/login
3. Click "New +" and select "Web Service"
4. Connect your Git repository
5. Render will auto-detect the `render.yaml` configuration
6. Add environment variable:
   - `BROWSERLESS_TOKEN`: Your Browserless.io API token
7. Click "Create Web Service"
8. Copy the service URL (e.g., `https://your-service.onrender.com`)

**Note**: Render free tier spins down after inactivity. First request may take 30-60 seconds.

### Option 2: Deploy to Railway

1. Push this `playwright-service` folder to a Git repository
2. Go to [railway.app](https://railway.app/) and sign up/login
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Add environment variable:
   - `BROWSERLESS_TOKEN`: Your Browserless.io API token
6. Railway will auto-deploy using `railway.json`
7. Go to Settings → Generate Domain to get your service URL

**Note**: Railway free tier includes 500 hours/month and $5 credit.

### Option 3: Deploy to Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. From this directory, run: `fly launch`
4. Set environment variable: `fly secrets set BROWSERLESS_TOKEN=your_token`
5. Deploy: `fly deploy`
6. Get URL: `fly info`

**Note**: Fly.io free tier includes 3 shared-cpu VMs.

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and add your BROWSERLESS_TOKEN

# Run the service
npm start
```

Service will run on `http://localhost:3001`

## API Usage

### Health Check
```bash
GET /
```

Response:
```json
{
  "status": "ok",
  "service": "Playwright Test Generator",
  "version": "1.0.0"
}
```

### Analyze Website
```bash
POST /analyze
Content-Type: application/json

{
  "url": "https://example.com",
  "loginConfig": {
    "loginUrl": "https://example.com/login",
    "usernameField": "email",
    "passwordField": "password",
    "testUsername": "test@example.com",
    "testPassword": "testpass123"
  }
}
```

Response:
```json
{
  "success": true,
  "tests": [
    {
      "title": "Validate Login Form Submission",
      "preconditions": "User is on the login page",
      "steps": ["Navigate to form", "Fill in fields", "Click submit"],
      "expectedResults": "User is logged in successfully",
      "priority": "High",
      "category": "Authentication"
    }
  ]
}
```

## Configuration for Your Edge Function

After deploying, update your Supabase Edge Function to call this service:

```javascript
const PLAYWRIGHT_SERVICE_URL = 'https://your-service.onrender.com';

const response = await fetch(`${PLAYWRIGHT_SERVICE_URL}/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, loginConfig })
});

const result = await response.json();
```

## Troubleshooting

**Service times out on first request (Render)**
- Free tier spins down after inactivity
- Wait 30-60 seconds for service to start

**Analysis fails with browser errors**
- Verify BROWSERLESS_TOKEN is set correctly
- Check Browserless.io usage limits
- Review service logs for detailed errors

**Memory issues on free tier**
- Service is optimized for free tier
- Limits: 3 pages max, 5 forms, 3 tables, 10 buttons
- Reduce timeout values if needed

## Cost Comparison

All platforms offer free tiers suitable for testing:

- **Render**: 750 hours/month free (spins down after inactivity)
- **Railway**: $5 credit + 500 hours/month free
- **Fly.io**: 3 shared VMs free (always on)
- **Browserless.io**: 1000 API calls/month free

For production, expect ~$7-15/month combined.
