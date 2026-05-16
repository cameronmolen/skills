# Example: Splitting a Large Feature into Small Tasks

The "Unit Selection System" feature is complex — it involves filtering, card layout, pricing display, badges, and an inline lead form. Rather than creating one 8-point monolith, split it into focused tasks that are each 1-3 points.

---

## Task 1: Unit Card Layout & Data Display (3 points)

**Properties:**
- Name: "Copycat LDP: Unit Card Layout & Data Display"
- Status: "Inbound"
- Team: "Host"
- Points/Effort/Complexity: "3"

**Content:**

## Description
Build the `CopycatUnitCard` component that renders a single unit stub in the new copycat card layout. This is the core visual building block — just the static display, no interactions or form.

**Figma Design:** [LDP Copycat (full page)](https://www.figma.com/design/tODBo3qnwXzd75rLREWIiO/Platform-Partner-Renter-Experience?node-id=5946-4031)

Refer to individual unit cards in the "Available units" section of the left column.

**New Components:**
- `CopycatUnitCard.tsx` — Card displaying unit size + type, feature bullets, pricing, badges, and a "Book now" button (button wired up in a separate task)

**Existing code to reuse:**
- `Stub` type + `createStub` from `StubType.ts` — unit data model
- `SpaceSummary` — unit size display component
- `PricingSummary` — price display with fee breakdown
- `PromotionTags` — discount badge display
- `FeatureBulletPoints` — feature bullet list

**Key implementation details:**
- Bordered card layout with unit info on the left and pricing on the right
- "Recommended" badge on the primary/first unit
- "Act fast: X left" urgency text when `maxQuantity` is low
- Discount badge (e.g. "50% off 1st month") with crossed-out original price
- One-time fee note (e.g. "+$29 one-time fee") below the monthly price

## Acceptance Criteria
- [ ] Unit card renders size + type label (e.g. "10' x 20' Self Storage Unit, Indoor")
- [ ] Feature bullets display from `briefFeatures`
- [ ] "Recommended" badge appears on the primary/first unit
- [ ] "Act fast: X left" urgency text appears when `maxQuantity` is low
- [ ] Discount badge shows promotion text with crossed-out original price
- [ ] One-time fee note displays below the monthly price
- [ ] "Book now" button renders (click handler is a no-op/prop for now)

---

## Task 2: Size Filter Chips (2 points)

**Properties:**
- Name: "Copycat LDP: Size Filter Chips"
- Status: "Inbound"
- Team: "Host"
- Points/Effort/Complexity: "2"

**Content:**

## Description
Build the size filter chip bar and filtering logic for the unit list. Chips are derived from the available stubs and allow users to filter units by size.

**Figma Design:** [LDP Copycat (full page)](https://www.figma.com/design/tODBo3qnwXzd75rLREWIiO/Platform-Partner-Renter-Experience?node-id=5946-4031)

Refer to the horizontal chip bar above the unit cards in the "Available units" section.

**New Components:**
- `SizeFilterChips.tsx` — Horizontal scrollable chip bar showing available unit sizes (e.g. 5x5, 5x10, 10x10)
- `useSizeFilter.ts` — Hook to derive unique sizes from stubs and manage selected filter state

**Existing code to reuse:**
- `Stub` type from `StubType.ts` — read `width` and `length` fields

**Key implementation details:**
- Chips derived from unique `width x length` combinations across all stubs
- "All" chip selected by default

## Acceptance Criteria
- [ ] Size filter chips render horizontally, derived from available stub sizes
- [ ] "All" chip is selected by default and shows all units
- [ ] Clicking a size chip filters the unit list to matching sizes only
- [ ] Selecting "All" again clears the filter and shows everything

---

## Task 3: Units Section Layout & Grouping (2 points)

**Properties:**
- Name: "Copycat LDP: Units Section Layout & Grouping"
- Status: "Inbound"
- Team: "Host"
- Points/Effort/Complexity: "2"

**Content:**

## Description
Build the `CopycatUnitsSection` wrapper that groups units into "Storage units" and "Vehicle units" subsections, renders section headers with icons, and composes the filter chips and unit card list together.

**Figma Design:** [LDP Copycat (full page)](https://www.figma.com/design/tODBo3qnwXzd75rLREWIiO/Platform-Partner-Renter-Experience?node-id=5946-4031)

Refer to the "Available units" section header and the "Storage units" / "Vehicle units" subsection headers.

**New Components:**
- `CopycatUnitsSection.tsx` — Section header ("Available units" + filter toggle button), subsection headers with icons, wraps unit card list

**Existing code to reuse:**
- `CopycatUnitCard` (from Task 1)
- `SizeFilterChips` + `useSizeFilter` (from Task 2)

**Key implementation details:**
- Units split into subsections based on `canStoreVehicle` field
- Each subsection has an icon and label header

## Acceptance Criteria
- [ ] "Available units" section header renders with a filter/view toggle button
- [ ] Units are separated into "Storage units" and "Vehicle units" subsections with appropriate icons
- [ ] Empty subsections are hidden (e.g. if no vehicle units exist)
- [ ] Filter chips and unit cards compose correctly together

---

## Task 4: Inline Lead Form on "Book Now" (3 points)

**Properties:**
- Name: "Copycat LDP: Inline Lead Form on Book Now"
- Status: "Inbound"
- Team: "Host"
- Points/Effort/Complexity: "3"

**Content:**

## Description
Wire up the "Book now" button on each unit card to expand an inline `EmbeddedLeadForm` within the card. This connects the unit selection to the existing lead form infrastructure.

**Figma Design:** [LDP Copycat (full page)](https://www.figma.com/design/tODBo3qnwXzd75rLREWIiO/Platform-Partner-Renter-Experience?node-id=5946-4031)

Refer to the expanded form state shown when "Book now" is clicked on a unit card.

**Existing code to reuse:**
- `EmbeddedLeadForm` + `useEmbeddedLeadForm` — reservation form
- `CopycatUnitCard` (from Task 1) — add expand/collapse behavior

**Key implementation details:**
- "Book now" click selects that stub and expands the form inline within the card
- Form includes: Name, Email, Phone, Move-in date, ToS toggle, Submit button
- Only one card's form should be expanded at a time
- "No payment required — Cancel anytime" messaging displays

## Acceptance Criteria
- [ ] Clicking "Book now" expands the `EmbeddedLeadForm` inline within the unit card
- [ ] Only one form is expanded at a time — clicking another "Book now" collapses the previous
- [ ] Lead form submits correctly and fires appropriate analytics events
- [ ] Lead form includes ToS acceptance toggle and legal consent text
- [ ] "No payment required — Cancel anytime" and "Full refund up to 24 hours" messaging displays

---

## Why This Split is Better

The original 8-point task had 14 acceptance criteria spanning filtering, layout, pricing, badges, and form behavior. By splitting into 4 tasks (3 + 2 + 2 + 3 = 10 points total):

- Each task is independently implementable and reviewable
- Tasks 1 and 2 can be worked on in parallel
- Task 3 composes tasks 1 and 2 together
- Task 4 adds interactivity on top of the static display
- A reviewer can understand and verify each task in isolation

