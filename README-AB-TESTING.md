# A/B Testing Infrastructure - Medicare California

This repository includes a lightweight A/B testing framework designed for static Cloudflare Pages. No server-side rendering required.

## Overview

The A/B testing system works by:
1. **Assigning variants** to visitors using persistent cookies (survives across sessions)
2. **Applying DOM changes** based on variant assignment
3. **Tracking results** in Google Analytics 4 with custom dimensions
4. **Configuration** via a simple JavaScript object at the top of `ab-testing.js`

## File Location

- **Framework**: `/ab-testing.js` (loaded in index.html)
- **GA4 Property ID**: `G-QT10YEXDCJ` (Medicare California)

## Quick Start: Define a New Test

### 1. Open `/ab-testing.js`

### 2. Add your test to the `AB_TESTS` configuration object

**Example: Test a new hero headline**

```javascript
const AB_TESTS = {
  'hero-headline-v1': {
    enabled: true,
    variants: {
      control: {
        // Control = no changes (original experience)
      },
      variant_a: {
        selector: '.hero-banner h1',
        innerHTML: 'Find Your Perfect Medicare Plan Today'
      },
      variant_b: {
        selector: '.hero-banner h1',
        innerHTML: 'Get Expert Medicare Help for Free'
      }
    },
    traffic: 0.5,  // 50% of visitors see the test (50% control, 25% var_a, 25% var_b)
    duration: 30   // Optional: track duration in days
  }
};
```

### 3. Supported Variant Changes

You can modify elements in multiple ways:

```javascript
// Change HTML content
innerHTML: 'New heading text'

// Change text only (no HTML tags)
textContent: 'Plain text'

// Replace all classes
className: 'new-class-name'

// Add classes without replacing existing ones
addClass: 'highlight-class'  // or ['class1', 'class2']

// Set HTML attributes (href, src, data-*, etc.)
setAttribute: {
  'href': 'https://new-url.com',
  'target': '_blank',
  'data-test': 'value'
}

// Apply inline CSS styles
style: {
  'color': '#FF0000',
  'font-weight': 'bold',
  'display': 'none'
}

// Set data attributes
dataset: {
  'testId': 'my-value',
  'variant': 'a'
}
```

### 4. Deploy

Simply commit and push. The variant assignment happens automatically on first visit.

## Testing Your Experiment

### View Assignments in Browser Console

```javascript
// See your current variant assignment(s)
ABTestInfo()

// Output example:
// {
//   assignments: { 'hero-headline-v1': 'variant_a' },
//   cookies: [{ name: 'hero-headline-v1', variant: 'variant_a' }]
// }
```

### Force a Specific Variant

Useful for QA and testing different variations:

```javascript
// Force variant for testing
ForceVariant('hero-headline-v1', 'variant_b')

// Then reload the page to see changes
```

### Clear Test Assignments

To reset and get a new random assignment:

```javascript
// Clear all tests
ClearABTests()

// Clear a specific test
ClearABTests('hero-headline-v1')

// Then reload
```

## Checking Results in Google Analytics 4

### 1. Navigate to GA4 Property

- Go to [Google Analytics](https://analytics.google.com)
- Select property: `G-QT10YEXDCJ` (Medicare California)

### 2. View Test Data

**Option A: Using Events Report**
- Left sidebar → Reports → Events
- Look for event: `ab_test_assigned`
- Filter by event parameter: `test_name`

**Option B: Using Explorations**
- Left sidebar → Explore → Create New Exploration
- Select "Free Form" template
- Dimensions: `test_name`, `ab_variant`
- Metrics: `Sessions`, `Event Count`, `Conversion Rate`
- Compare variants by `ab_variant` dimension

**Option C: Using Custom Reports**
- Create a custom report filtering by custom dimensions:
  - `ab_test` = test name
  - `ab_variant` = variant name

### 3. Metrics to Monitor

- **Sessions per variant**: Equal distribution means fair test
- **Conversion rate**: Which variant drives better results?
- **Bounce rate**: Are variants impacting engagement?
- **Event count**: Track interaction differences
- **Page views**: How does flow differ?

### 4. Statistical Significance

For a result to be meaningful:
- Run for at least 2-4 weeks (seasonal variations)
- Aim for 1,000+ sessions per variant minimum
- Monitor confidence levels (>95% is good)

## Ending a Test & Picking a Winner

### 1. Collect Results (2-4 weeks)

Use GA4 to monitor conversion rates, bounce rate, and engagement metrics.

### 2. Analyze in GA4

Compare your metrics across variants. Look for statistical significance (95%+ confidence).

### 3. Make Decision

Once you have a clear winner:

**If Control Wins (or no clear winner):**
- Keep original unchanged
- Remove test from `AB_TESTS` configuration
- Delete the cookie assignment: `ClearABTests('test-name')`

**If Variant Wins:**
- Update the permanent version in your HTML
- Roll out to 100% of visitors

### 4. Deploy Winner

```javascript
// Option A: Roll variant to 100% (make it control)
const AB_TESTS = {
  'hero-headline-v1': {
    enabled: false  // Disable test - now at 100% for everyone
  }
};

// Then update your HTML directly with the winning copy/layout
// And remove the test from AB_TESTS entirely
```

### 5. Clean Up

Once deployed:
- Remove the test from `AB_TESTS` configuration
- Remove old test cookies
- Document the result in your commit message

## Example: Complete Test Workflow

### Setup (Day 1)
```javascript
const AB_TESTS = {
  'cta-color-test': {
    enabled: true,
    variants: {
      control: {},
      variant_a: {
        selector: '.cta-button',
        setAttribute: { 'style': 'background-color: #FF6B35;' }
      }
    },
    traffic: 0.5
  }
};
```

### Testing (Days 2-3)
```javascript
// Test each variant in console
ForceVariant('cta-color-test', 'control')  // reload
ForceVariant('cta-color-test', 'variant_a')  // reload
```

### Monitoring (Days 4-28)
- Check GA4 daily for data collection
- Monitor conversion rates
- Watch for issues

### Analysis (Day 29)
- Variant A: 8.5% conversion rate
- Control: 7.2% conversion rate
- Winner: Variant A (18% improvement)

### Deployment (Day 30)
```javascript
// Update permanent code
// In index.html, change CTA button color directly

// Remove from AB_TESTS or disable:
const AB_TESTS = {
  // test removed
};

// Clear cookies
ClearABTests('cta-color-test')
```

## Technical Details

### Cookie Structure

Each test stores a persistent cookie:
- **Name**: `ab_test_{test-name}`
- **Value**: `control`, `variant_a`, `variant_b`, etc.
- **Expiration**: 365 days from last visit
- **Scope**: Path `/` for all pages

### GA4 Integration

Variant assignments are sent as:
- **Event**: `ab_test_assigned`
- **Event parameters**:
  - `test_name`: Name of the test
  - `variant`: Assigned variant
  - `test_date`: Date assigned
- **User properties**:
  - `ab_test`: Most recent test name
  - `ab_variant`: Most recent variant

### Traffic Distribution

When `traffic: 0.5`:
- 50% see the test (split equally among variants)
- 50% see control (original)

Example with 3 variants:
- `traffic: 0.6` → 60% in test, 40% control
  - If 3 variants: 20% each + 40% control

### Browser Support

Works on all modern browsers (Chrome, Firefox, Safari, Edge). Requires:
- Cookies enabled
- JavaScript enabled
- No special frameworks

## Troubleshooting

### Test not applying?

1. Check selector is correct:
   ```javascript
   // In console, verify element exists
   document.querySelectorAll('.hero-banner h1').length
   // Should return > 0
   ```

2. Clear test and reload:
   ```javascript
   ClearABTests('test-name')
   ```

3. Check console for JS errors

### GA4 not showing events?

1. Verify GA4 is loaded:
   ```javascript
   typeof gtag !== 'undefined'  // should be true
   ```

2. Check GA4 property ID is correct in ab-testing.js

3. Allow 24 hours for events to appear in reports (real-time may show immediately)

### Traffic skewed (not 50/50)?

This is normal for new visitors. After running for a week, distribution should be approximately equal as more users get assigned.

## Advanced: Custom Event Tracking

To track custom events in your variant:

```javascript
variants: {
  variant_a: {
    selector: '.form-button',
    innerHTML: 'Submit for Free',
    // Note: You can also add onclick handlers via setAttribute
    setAttribute: {
      'onclick': 'gtag("event", "variant_a_click");'
    }
  }
}
```

## Support

For questions about the framework or implementation, check:
- Browser console: `ABTestInfo()` for current assignments
- GA4 Property ID: `G-QT10YEXDCJ`
- AB Testing File: `/ab-testing.js`
