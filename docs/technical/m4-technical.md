# M4 Technical Design — Booking Form + Validation

## Scope (M4)
- Booking form with start date and nights inputs
- Real-time validation and error display
- Derived date range calculation and display
- "Reserve" button state management
- Integration with M3 context (facility/site IDs)

## Architecture
- **Renderer-only implementation** (no new IPC channels needed)
- Form state managed in `renderer.js`
- Validation logic runs on input events
- Context subscription from M3 used to enable/disable button
- No persistence in M4 (future enhancement)

## Data Model

```typescript
interface BookingFormState {
  startDate: Date | null;
  nights: number;
  isValid: boolean;
  errors: {
    startDate?: string;
    nights?: string;
    context?: string;
  };
}

interface DerivedDateRange {
  start: Date;
  end: Date;
  nights: number;
  formatted: string; // "May 17, 2026 → May 18, 2026 (1 night)"
}
```

## Form Validation Logic

```javascript
function validateBookingForm() {
  const errors = {};
  let isValid = true;

  // Validate start date
  const startDate = startDateEl.valueAsDate;
  if (!startDate) {
    errors.startDate = 'Start date is required';
    isValid = false;
  }

  // Validate nights (1-14)
  const nights = parseInt(nightsEl.value, 10);
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
```

## Date Range Calculation

```javascript
function computeDateRange() {
  const startDate = startDateEl.valueAsDate;
  const nights = parseInt(nightsEl.value, 10);

  if (!startDate || isNaN(nights) || nights < 1) {
    dateRangeEl.textContent = '';
    return null;
  }

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + nights);

  const fmt = (d) => d.toLocaleDateString(undefined, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });

  const nightsText = nights === 1 ? '1 night' : `${nights} nights`;
  const formatted = `${fmt(startDate)} → ${fmt(endDate)} (${nightsText})`;

  dateRangeEl.textContent = formatted;
  return { start: startDate, end: endDate, nights, formatted };
}
```

## Button State Management

```javascript
function updateReserveButton() {
  const { isValid, errors } = validateBookingForm();
  
  reserveBtn.disabled = !isValid;
  
  // Update tooltip/helper text
  if (!isValid) {
    const reasons = Object.values(errors).filter(Boolean);
    reserveBtn.title = reasons.join('; ');
  } else {
    reserveBtn.title = 'Start reservation process';
  }
}

// Wire up event listeners
startDateEl.addEventListener('change', () => {
  computeDateRange();
  updateReserveButton();
});

nightsEl.addEventListener('input', () => {
  computeDateRange();
  updateReserveButton();
});

// Subscribe to context changes
window.ra.onContextChanged((ctx) => {
  currentContext = ctx;
  updateReserveButton();
});
```

## Error Display

```javascript
function displayErrors(errors) {
  // Clear previous errors
  formErrorsEl.textContent = '';
  
  // Display new errors
  const errorMessages = Object.values(errors).filter(Boolean);
  if (errorMessages.length > 0) {
    formErrorsEl.textContent = errorMessages.join('. ');
    formErrorsEl.classList.remove('hidden');
  } else {
    formErrorsEl.classList.add('hidden');
  }
}
```

## HTML Structure (Existing + Updates Needed)

The booking form already exists in `renderer/index.html` (lines 82-94). Updates needed:

```html
<section class="mt-5 pt-4 border-t border-dashed border-[#dacdb9]">
  <h2 class="text-sm font-serif text-[#2f6b4f] mb-2">Booking Form</h2>
  <label class="block text-sm text-slate-700 mb-2">Start date
    <input type="date" id="startDate" class="mt-1 block w-full rounded-md border border-[#d9cab4] bg-white px-3 py-2 text-sm shadow-sm focus:border-[#c07a2c] focus:outline-none focus:ring-1 focus:ring-[#c07a2c]">
  </label>
  <label class="block text-sm text-slate-700 mb-2">Nights
    <input type="number" id="nights" value="1" min="1" max="14" step="1" class="mt-1 block w-full rounded-md border border-[#d9cab4] bg-white px-3 py-2 text-sm shadow-sm focus:border-[#c07a2c] focus:outline-none focus:ring-1 focus:ring-[#c07a2c]">
  </label>
  <div class="text-sm">
    <div><span class="text-slate-500">Date range:</span> <code id="dateRange"></code></div>
    <div id="formErrors" class="text-red-700 mt-1"></div>
  </div>
</section>
```

**Changes needed:**
- Add `max="14"` to nights input
- Set default date value to 9 months from today via JavaScript on load

## Implementation Plan

### 1. Initialize Form with Default Values
Add initialization code in `renderer.js`:

```javascript
// Set default date to 9 months from today
function initializeBookingForm() {
  const nineMonthsFromNow = new Date();
  nineMonthsFromNow.setMonth(nineMonthsFromNow.getMonth() + 9);
  
  // Format as YYYY-MM-DD for date input
  const dateStr = nineMonthsFromNow.toISOString().split('T')[0];
  startDateEl.value = dateStr;
  
  // Trigger initial date range calculation
  computeDateRange();
  updateReserveButton();
}

// Call on load
initializeBookingForm();
```

### 2. Add Reserve Button
Add button to the booking form section in HTML:

```html
<button id="reserveBtn" disabled class="mt-3 w-full inline-flex items-center justify-center rounded-md bg-[#2f6b4f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#25533e] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#2f6b4f]">
  Reserve
</button>
```

### 3. Update HTML Input Constraints
- Add `max="14"` attribute to nights input

### 4. Enhance Validation Logic
Update existing `computeDateRange()` function in `renderer.js` to:
- Call validation on every change
- Check nights ≤ 14
- Update error display
- Update button state

### 5. Wire Context Integration
Subscribe to context changes and update button state when context changes.

### 6. Add Reserve Handler (Stub)
```javascript
reserveBtn.addEventListener('click', () => {
  const { startDate, nights } = validateBookingForm();
  const { facilityId, siteId } = currentContext;
  
  console.log('[Reserve] Starting reservation:', {
    facilityId,
    siteId,
    startDate: startDate.toISOString(),
    nights
  });
  
  // M5 will implement actual reservation logic
  alert('Reservation form valid! (M5 will implement actual booking)');
});
```

## Acceptance Tests

### Manual Testing
1. **Initial load**: Form shows date 9 months from today, nights = 1, date range displayed
2. **Reserve button**: Disabled initially (no context)
3. **Navigate to campsite**: Button still disabled (need to verify form)
4. **Valid form on campsite**: Button enables
5. **Click Reserve**: Console logs booking data
6. **Clear date**: Button disables, error shows
7. **Set nights to 0**: Error shows, button disables
8. **Set nights to 15**: Error shows "cannot exceed 14", button disables
9. **Navigate away from campsite**: Button disables
10. **Rapid input changes**: Validation debounces, no performance issues

### Edge Cases
- Rapid input changes → debounce validation (100ms)
- Date in past → allow (RA validates server-side)
- Date beyond 9 months → allow (user may book earlier if available)
- Nights > 14 → enforce maximum, show error
- Context changes while form filled → re-validate button state

## Security & Privacy
- No sensitive data stored
- Form data only logged to console in M4
- M5 will handle secure API calls with user's cookies

## Performance Considerations
- Validation is lightweight (runs on every input)
- Date calculations are synchronous and fast
- No network calls in M4
- Debounce rapid input changes to avoid excessive re-renders

## Risks & Mitigations
- **Risk**: User confusion about why button is disabled
  - **Mitigation**: Clear error messages and tooltip on disabled button
- **Risk**: Date range calculation edge cases (DST, leap years)
  - **Mitigation**: Use native Date APIs; test edge cases
- **Risk**: Form state lost on navigation
  - **Mitigation**: Document as known limitation; consider localStorage in future

## Future Enhancements
- Persist form state to localStorage
- Pre-fill from URL query params
- Show calendar with availability overlay
- Support date range picker (start + end date)
- Add tooltip explaining 9-month default date
- Adjust max nights based on campground rules (some allow longer stays)


