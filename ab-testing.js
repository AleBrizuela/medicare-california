/**
 * Lightweight A/B Testing Framework for Cloudflare Pages
 * Supports cookie-based variant assignment and GA4 integration
 */

// ──────────────────────────────────────────────────────────────
// AB_TESTS CONFIGURATION - Define your experiments here
// ──────────────────────────────────────────────────────────────

const AB_TESTS = {
  // Example test configuration:
  // 'test-name': {
  //   enabled: true,
  //   variants: {
  //     control: {
  //       // No changes for control (original experience)
  //     },
  //     variant_a: {
  //       selector: '.element-selector',
  //       innerHTML: 'New headline text',
  //       // OR use 'textContent' for text-only changes
  //       // OR use 'className' to add/change classes
  //       // OR use 'setAttribute' with {key: value} pairs
  //     }
  //   },
  //   traffic: 0.5,  // 50% see test (0-1)
  //   duration: 30   // days (optional, for tracking)
  // }
};

// ──────────────────────────────────────────────────────────────
// CORE A/B TESTING ENGINE
// ──────────────────────────────────────────────────────────────

class ABTestManager {
  constructor(config = {}) {
    this.tests = config.tests || AB_TESTS;
    this.cookieDomain = config.cookieDomain || '';
    this.cookiePath = config.cookiePath || '/';
    this.gaPropertyId = config.gaPropertyId || '';
    this.assignments = {};
    this.init();
  }

  /**
   * Initialize the AB testing system
   */
  init() {
    // Load persisted variant assignments from cookies
    this.loadAssignments();

    // Apply variant changes to DOM
    this.applyVariants();

    // Send assignments to GA4
    if (this.gaPropertyId || this.isGAAvailable()) {
      this.sendToGA4();
    }
  }

  /**
   * Get or create variant assignment for a test
   */
  getVariantAssignment(testName, variants, trafficPercentage = 1.0) {
    const cookieName = `ab_test_${testName}`;
    const stored = this.getCookie(cookieName);

    if (stored && variants[stored]) {
      return stored;
    }

    // Decide if user is in test based on traffic percentage
    if (Math.random() > trafficPercentage) {
      return 'control';
    }

    // Randomly assign to a variant
    const variantKeys = Object.keys(variants);
    const assigned = variantKeys[Math.floor(Math.random() * variantKeys.length)];

    // Persist the assignment
    this.setCookie(cookieName, assigned, 365); // 1 year
    return assigned;
  }

  /**
   * Apply DOM changes for each active test
   */
  applyVariants() {
    Object.entries(this.tests).forEach(([testName, testConfig]) => {
      if (testConfig.enabled === false) return;

      const variants = testConfig.variants || {};
      const traffic = testConfig.traffic || 1.0;
      const assigned = this.getVariantAssignment(testName, variants, traffic);

      this.assignments[testName] = assigned;

      const variantConfig = variants[assigned];
      if (!variantConfig || assigned === 'control') return;

      // Apply changes for this variant
      this.applyVariantChanges(variantConfig);
    });
  }

  /**
   * Apply a specific variant's DOM changes
   */
  applyVariantChanges(variantConfig) {
    const selector = variantConfig.selector;
    if (!selector) return;

    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      // Update innerHTML
      if (variantConfig.innerHTML !== undefined) {
        el.innerHTML = variantConfig.innerHTML;
      }

      // Update textContent
      if (variantConfig.textContent !== undefined) {
        el.textContent = variantConfig.textContent;
      }

      // Update or add classes
      if (variantConfig.className !== undefined) {
        el.className = variantConfig.className;
      }

      // Add classes without replacing
      if (variantConfig.addClass !== undefined) {
        const classes = Array.isArray(variantConfig.addClass)
          ? variantConfig.addClass
          : [variantConfig.addClass];
        classes.forEach(cls => el.classList.add(cls));
      }

      // Set attributes
      if (variantConfig.setAttribute !== undefined) {
        Object.entries(variantConfig.setAttribute).forEach(([key, value]) => {
          el.setAttribute(key, value);
        });
      }

      // Apply inline styles
      if (variantConfig.style !== undefined) {
        Object.assign(el.style, variantConfig.style);
      }

      // Apply data attributes
      if (variantConfig.dataset !== undefined) {
        Object.entries(variantConfig.dataset).forEach(([key, value]) => {
          el.dataset[key] = value;
        });
      }
    });
  }

  /**
   * Send variant assignments to Google Analytics 4
   */
  sendToGA4() {
    if (typeof gtag === 'undefined') {
      // GA4 not loaded yet, retry after a short delay
      setTimeout(() => this.sendToGA4(), 500);
      return;
    }

    Object.entries(this.assignments).forEach(([testName, variant]) => {
      // Send as custom event with user_properties
      try {
        gtag('event', 'ab_test_assigned', {
          'test_name': testName,
          'variant': variant,
          'test_date': new Date().toISOString().split('T')[0]
        });

        // Also set as user property for easier segmentation
        gtag('set', {
          'ab_test': testName,
          'ab_variant': variant
        });
      } catch (e) {
        console.debug('GA4 event send failed:', e);
      }
    });
  }

  /**
   * Check if GA4 (gtag) is available
   */
  isGAAvailable() {
    return typeof gtag !== 'undefined';
  }

  /**
   * Cookie management
   */
  getCookie(name) {
    if (typeof document === 'undefined') return null;
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length));
      }
    }
    return null;
  }

  setCookie(name, value, days = 365) {
    if (typeof document === 'undefined') return;
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + date.toUTCString();
    let cookieString = `${name}=${encodeURIComponent(value)};${expires};path=${this.cookiePath}`;
    if (this.cookieDomain) {
      cookieString += `;domain=${this.cookieDomain}`;
    }
    document.cookie = cookieString;
  }

  /**
   * Load all variant assignments from cookies
   */
  loadAssignments() {
    Object.keys(this.tests).forEach(testName => {
      const assignment = this.getCookie(`ab_test_${testName}`);
      if (assignment) {
        this.assignments[testName] = assignment;
      }
    });
  }

  /**
   * Get current variant for a test
   */
  getVariant(testName) {
    return this.assignments[testName] || 'control';
  }

  /**
   * Get all assignments
   */
  getAllAssignments() {
    return { ...this.assignments };
  }

  /**
   * Clear all test cookies (useful for development)
   */
  clearAllTests() {
    Object.keys(this.tests).forEach(testName => {
      this.setCookie(`ab_test_${testName}`, '', -1);
    });
    this.assignments = {};
  }

  /**
   * Clear a specific test
   */
  clearTest(testName) {
    this.setCookie(`ab_test_${testName}`, '', -1);
    delete this.assignments[testName];
  }

  /**
   * Get analytics data for test results
   * Note: This requires GA4 access via API or Analytics reporting interface
   */
  static generateGoogleAnalyticsQuery(testName, dateRange = '30d') {
    return {
      property: 'REPLACE_WITH_PROPERTY_ID',
      dimensions: ['dimension: ab_test', 'dimension: ab_variant'],
      metrics: ['metric: sessions', 'metric: eventCount'],
      where: `dimension: ab_test == '${testName}'`,
      dateRange: dateRange,
      orderBy: [{metric: 'metric: sessions', order: 'DESCENDING'}]
    };
  }
}

// ──────────────────────────────────────────────────────────────
// INITIALIZE ON PAGE LOAD
// ──────────────────────────────────────────────────────────────

// Detect GA4 property from page's gtag config
function detectGA4Property() {
  // Try to get from gtag's dataLayer
  if (typeof window !== 'undefined' && window.dataLayer) {
    for (let item of window.dataLayer) {
      if (item.config) {
        // Find the GA4 property ID (starts with 'G-')
        const keys = Object.keys(item.config);
        for (let key of keys) {
          if (key.startsWith('G-')) {
            return key;
          }
        }
      }
    }
  }
  return '';
}

// Initialize the manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.ABTestManager = new ABTestManager({
      gaPropertyId: detectGA4Property()
    });
  });
} else {
  window.ABTestManager = new ABTestManager({
    gaPropertyId: detectGA4Property()
  });
}

// ──────────────────────────────────────────────────────────────
// DEVELOPMENT HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Helper to view current test assignments in console
 * Usage: console.log(ABTestInfo())
 */
window.ABTestInfo = function() {
  if (!window.ABTestManager) {
    return 'ABTestManager not initialized yet';
  }
  return {
    assignments: window.ABTestManager.getAllAssignments(),
    cookies: Object.keys(window.ABTestManager.tests).map(test => ({
      name: test,
      variant: window.ABTestManager.getVariant(test)
    }))
  };
};

/**
 * Helper to clear tests from console
 * Usage: ClearABTests() to clear all, or ClearABTests('test-name') for specific
 */
window.ClearABTests = function(testName) {
  if (!window.ABTestManager) {
    console.log('ABTestManager not initialized yet');
    return;
  }
  if (testName) {
    window.ABTestManager.clearTest(testName);
    console.log(`Cleared test: ${testName}`);
  } else {
    window.ABTestManager.clearAllTests();
    console.log('Cleared all tests');
  }
  console.log('Please reload the page to see changes');
};

/**
 * Force a specific variant for testing
 * Usage: ForceVariant('test-name', 'variant_a')
 */
window.ForceVariant = function(testName, variantName) {
  if (!window.ABTestManager) {
    console.log('ABTestManager not initialized yet');
    return;
  }
  window.ABTestManager.setCookie(`ab_test_${testName}`, variantName, 365);
  window.ABTestManager.assignments[testName] = variantName;
  console.log(`Forced ${testName} to ${variantName}. Please reload the page.`);
};
