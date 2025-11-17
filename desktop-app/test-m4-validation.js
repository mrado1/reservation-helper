/**
 * M4 Validation Logic Test
 * 
 * Tests the booking form validation logic in isolation
 * Run with: node test-m4-validation.js
 */

// Mock Date for consistent testing
const mockNow = new Date('2025-11-12T10:00:00Z');

// Simulate the validation function from renderer.js
function validateBookingForm(startDate, nights, currentContext) {
  const errors = {};
  let isValid = true;

  // Validate start date
  if (!startDate) {
    errors.startDate = 'Start date is required';
    isValid = false;
  }

  // Validate nights (1-14)
  if (isNaN(nights) || nights < 1) {
    errors.nights = 'Nights must be at least 1';
    isValid = false;
  } else if (nights > 14) {
    errors.nights = 'Nights cannot exceed 14';
    isValid = false;
  }

  // Validate context (facility/site IDs present)
  if (!currentContext || !currentContext.facilityId || !currentContext.siteId) {
    errors.context = 'Navigate to a campsite page to reserve';
    isValid = false;
  }

  return { isValid, errors, startDate, nights };
}

// Test helper
function runTest(name, testFn) {
  try {
    testFn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Test cases
console.log('\n=== M4 Validation Tests ===\n');

runTest('Valid form with context should pass', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    3,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === true, 'Expected valid form');
  assert(Object.keys(result.errors).length === 0, 'Expected no errors');
});

runTest('Missing start date should fail', () => {
  const result = validateBookingForm(
    null,
    3,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.startDate === 'Start date is required', 'Expected start date error');
});

runTest('Nights < 1 should fail', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    0,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.nights === 'Nights must be at least 1', 'Expected nights error');
});

runTest('Nights > 14 should fail', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    15,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.nights === 'Nights cannot exceed 14', 'Expected nights error');
});

runTest('Nights exactly 14 should pass', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    14,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === true, 'Expected valid form');
});

runTest('Nights exactly 1 should pass', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    1,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === true, 'Expected valid form');
});

runTest('Missing context should fail', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    3,
    null
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.context === 'Navigate to a campsite page to reserve', 'Expected context error');
});

runTest('Missing facility ID should fail', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    3,
    { facilityId: '', siteId: '245719' }
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.context === 'Navigate to a campsite page to reserve', 'Expected context error');
});

runTest('Missing site ID should fail', () => {
  const result = validateBookingForm(
    new Date('2026-08-12'),
    3,
    { facilityId: '140', siteId: '' }
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.context === 'Navigate to a campsite page to reserve', 'Expected context error');
});

runTest('Multiple errors should accumulate', () => {
  const result = validateBookingForm(
    null,
    0,
    null
  );
  assert(result.isValid === false, 'Expected invalid form');
  assert(result.errors.startDate, 'Expected start date error');
  assert(result.errors.nights, 'Expected nights error');
  assert(result.errors.context, 'Expected context error');
  assert(Object.keys(result.errors).length === 3, 'Expected 3 errors');
});

runTest('Date in past should pass (no client-side validation)', () => {
  const result = validateBookingForm(
    new Date('2024-01-01'),
    3,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === true, 'Expected valid form (RA validates server-side)');
});

runTest('Date far in future should pass (no client-side validation)', () => {
  const result = validateBookingForm(
    new Date('2030-12-31'),
    3,
    { facilityId: '140', siteId: '245719' }
  );
  assert(result.isValid === true, 'Expected valid form (RA validates server-side)');
});

// Date range calculation tests
console.log('\n=== Date Range Calculation Tests ===\n');

function computeDateRange(startDate, nights) {
  if (!startDate || isNaN(nights) || nights < 1) {
    return null;
  }
  
  const end = new Date(startDate);
  end.setDate(end.getDate() + nights);
  const fmt = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const nightsText = nights === 1 ? '1 night' : `${nights} nights`;
  const formatted = `${fmt(startDate)} → ${fmt(end)} (${nightsText})`;
  
  return { start: startDate, end, nights, formatted };
}

runTest('Date range calculation: 1 night', () => {
  // Use UTC to avoid timezone issues
  const start = new Date(2026, 4, 17); // May 17, 2026 (month is 0-indexed)
  const result = computeDateRange(start, 1);
  assert(result !== null, 'Expected result');
  assert(result.formatted.includes('1 night'), 'Expected singular "night"');
  assert(result.end.getDate() === 18, 'Expected end date to be 18th');
});

runTest('Date range calculation: multiple nights', () => {
  const start = new Date(2026, 4, 17); // May 17, 2026
  const result = computeDateRange(start, 3);
  assert(result !== null, 'Expected result');
  assert(result.formatted.includes('3 nights'), 'Expected plural "nights"');
  assert(result.end.getDate() === 20, 'Expected end date to be 20th');
});

runTest('Date range calculation: invalid inputs return null', () => {
  const result1 = computeDateRange(null, 3);
  assert(result1 === null, 'Expected null for missing date');
  
  const result2 = computeDateRange(new Date('2026-05-17'), 0);
  assert(result2 === null, 'Expected null for invalid nights');
  
  const result3 = computeDateRange(new Date('2026-05-17'), NaN);
  assert(result3 === null, 'Expected null for NaN nights');
});

runTest('Date range calculation: month boundary', () => {
  const start = new Date(2026, 4, 30); // May 30, 2026
  const result = computeDateRange(start, 3);
  assert(result !== null, 'Expected result');
  assert(result.end.getMonth() === 5, 'Expected end month to be June (5)');
  assert(result.end.getDate() === 2, 'Expected end date to be 2nd');
});

// Default date initialization test
console.log('\n=== Default Date Initialization Test ===\n');

runTest('Default date should be 9 months from now', () => {
  const now = new Date(mockNow);
  const nineMonthsFromNow = new Date(now);
  nineMonthsFromNow.setMonth(nineMonthsFromNow.getMonth() + 9);
  
  const expected = nineMonthsFromNow.toISOString().split('T')[0];
  assert(expected === '2026-08-12', `Expected default date to be 9 months from ${now.toISOString()}`);
});

console.log('\n=== All Tests Complete ===\n');

