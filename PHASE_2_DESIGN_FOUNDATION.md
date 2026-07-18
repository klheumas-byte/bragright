# BragRight Phase 2.0 — Design Foundation

Date: 2026-07-18

Status: Complete and ready for Phase 2.1.

## Scope and guardrails

Phase 2.0 adds a compatibility-friendly UI foundation without redesigning the
application. Existing page structure, brand colors, gradients, typography
character, content, routes, permissions, API calls, state management, and
business workflows were preserved. New design-system CSS loads before the
legacy stylesheet so existing page selectors continue to win where the styles
overlap.

## Audit summary

All 18 React pages, shared components, layouts, contexts, and the complete
stylesheet were reviewed before implementation.

The main findings were:

- Repeated hardcoded colors, spacing, radii, shadows, font values, transitions,
  breakpoints, z-index values, and container widths.
- Six overlapping button class families with inconsistent loading markup.
- Page-local card implementations for dashboard, profile, match, admin,
  information, empty, and loading surfaces.
- Raw form controls with generally good labels but no reusable required,
  description, validation, checkbox, radio, switch, search, or date APIs.
- One page-local confirmation dialog.
- Separate success, error, skeleton, loading, badge-like, and empty treatments.
- No semantic reusable data table. Existing lists deliberately use card/list
  layouts and were not redesigned into tables.
- Responsive rules existed at 900px and 640px, but action-row wrapping,
  maximum control width, and modal behavior needed common safeguards.

## Files created

- `client/src/styles/tokens.css`
- `client/src/styles/design-system.css`
- `client/src/components/ui/Button.jsx`
- `client/src/components/ui/Card.jsx`
- `client/src/components/ui/FormControls.jsx`
- `client/src/components/ui/Feedback.jsx`
- `client/src/components/ui/Modal.jsx`
- `client/src/components/ui/DataTable.jsx`
- `client/src/components/ui/PageSection.jsx`
- `client/src/components/ui/index.js`

## Files modified

- `client/src/main.jsx`
- `client/src/index.css`
- `client/src/components/AppErrorBoundary.jsx`
- `client/src/components/BackButton.jsx`
- `client/src/components/ErrorState.jsx`
- `client/src/components/SectionLoader.jsx`
- `client/src/components/StatCard.jsx`
- `client/src/components/SuccessAlert.jsx`
- `client/src/pages/Login.jsx`
- `client/src/pages/Register.jsx`
- `client/src/pages/AdminActivity.jsx`
- `client/src/pages/AdminDisputes.jsx`
- `client/src/pages/AdminSettings.jsx`
- `client/src/pages/AdminUsers.jsx`
- `client/src/pages/HeadToHead.jsx`
- `client/src/pages/SubmitMatch.jsx`

No service, context, route configuration, API, backend, permission, or state
management file was changed for Phase 2.0.

## Tokens introduced

The token source includes:

- Brand, surface, text, border, accent, and status colors.
- A 0–64px spacing scale.
- Font family, seven font sizes, five weights, and three line heights.
- Radius steps from 8px through 34px plus pill radius.
- Five elevations and a focus ring.
- Fast, normal, and slow duration values with shared transitions.
- Base, raised, sidebar, popover, loading, modal, and toast layers.
- Small, medium, large, and extra-large container widths.
- Mobile, tablet, and desktop breakpoint values.
- Responsive page gutters and reduced-motion duration overrides.

Values were selected from the existing stylesheet. The root line height and
main public container width remain exactly at their previous values.

## Shared components introduced

### Button

Supports primary, secondary, outline, ghost, danger, and success variants;
small/default/large sizes; loading, disabled, icon-only, link rendering,
`aria-busy`, and consistent focus behavior.

### Card

Supports dashboard, stat-compatible, profile, match, admin, information, empty,
and loading surfaces while allowing semantic element selection and legacy
classes.

### Forms

Includes `FormField`, `Field`, `Input`, `Textarea`, `Select`, `SearchInput`,
`DateInput`, `Checkbox`, `Radio`, and `Switch`. Required indicators,
descriptions, validation announcements, `aria-required`, `aria-invalid`, and
`aria-describedby` are built in.

### DataTable

Provides semantic table markup, client- or server-controlled sorting, optional
pagination, loading, empty state, actions, captions, sortable-header semantics,
and a responsive stacked mobile layout. Existing card lists were not forced
onto this component.

### Modal

Supports confirmation, delete/danger, success, error, warning, and neutral
tones; small/default/large widths; scrollable content; portal rendering; Escape
close; focus containment; focus restoration; backdrop close; labelled and
described dialog semantics; and background scroll locking.

### Feedback

Includes Alert, Banner, Badge, Chip, Progress, Spinner, EmptyState, Toast, and
ToastRegion. Existing SectionSkeleton remains the canonical skeleton.

### PageSection

Provides an optional semantic section title, description, action area, content,
and stable labelled-region relationship.

## Pages and components migrated

- Login and Register: auth cards, required form fields, inputs, validation alert,
  and loading submit button.
- Admin Settings: number field and loading submit button.
- Admin Activity: loading filter button.
- Admin Disputes: resolution submit and reset buttons.
- Admin Users: create/status/reset buttons and the confirmation modal.
- Head-to-Head: primary submit button.
- Submit Match: schedule/result loading buttons.
- App error boundary: primary and secondary navigation actions.
- BackButton: secondary shared button.
- ErrorState and SuccessAlert: shared Alert foundation.
- StatCard and SectionLoader: shared Card foundation.

Every migrated element keeps its prior legacy class where that class affects
appearance.

## Legacy patterns intentionally retained

- Match action buttons and score/proof forms in `MyMatches` remain workflow-local.
- Profile editor/tab actions remain page-specific.
- Dashboard inline action links remain unchanged.
- Navbar, dashboard menu, user trigger, sidebar close, and other icon/navigation
  controls retain their specialized classes and behavior.
- Admin user, activity, dispute, leaderboard, and match card/list layouts remain
  intact rather than being converted to tables.
- Existing functional legacy CSS remains in place, including currently unused
  modal selectors, to reduce rollback and visual-regression risk.
- `ButtonLoadingText` remains for complex match/profile actions that were not
  safe to migrate narrowly.

## Accessibility improvements

- Consistent visible focus rings for buttons, links, inputs, selects, textareas,
  and focusable custom controls.
- Required-field indicators plus native and ARIA required semantics on migrated
  auth fields.
- Form descriptions and validation messages have stable descriptive links.
- Alerts announce errors assertively and other feedback politely.
- Modal labels/descriptions are programmatically connected.
- Modal focus is contained, Escape closes, background scroll is locked, and
  focus returns to the invoking control.
- Progress and spinner primitives expose correct status semantics.
- Sort state is applied to semantic table headers.
- Global reduced-motion handling covers animations and transitions.

## Responsive fixes

- Shared controls are width-bounded and long button text can wrap.
- Images are constrained to their container.
- Table shells scroll horizontally before switching to a stacked mobile layout.
- Admin resolution/user actions, match action rows, and profile editor actions
  wrap at tablet widths.
- Action children are width-bounded on mobile.
- Modal content is viewport-bounded, scrollable, and uses full-width mobile
  actions.
- Existing 900px and 640px layouts remain the source for page-specific layout
  changes.

## Verification

- Frontend tests: passed, 1/1.
- Frontend production build: passed with Vite 8.1.5 and no warnings.
- Frontend lint: no lint script or lint configuration is present; no lint command
  was available to run.
- `git diff --check`: passed.
- Static accessibility/responsive review: passed for the migrated primitives and
  retained layouts.
- Full diff review: Phase 2.0 changes are limited to styling, semantic UI
  wrappers, and equivalent JSX controls. Event handlers, submit payloads,
  effects, API calls, navigation destinations, permissions, and state
  transitions are unchanged.

## Visual regression risks

Risk is low but not zero because there is no configured browser screenshot
regression suite. The most visible intentional differences are required-field
asterisks, consistent loading spinners on migrated buttons, standardized focus
rings, and the confirmation dialog being portalled to the document body.
Legacy classes and stylesheet precedence preserve the existing sizing, color,
gradient, border, and shadow language.

## Remaining inconsistencies

- Many page-specific surfaces still use literal values from the legacy
  stylesheet rather than tokens.
- Complex match/profile actions still use legacy button/loading markup.
- Admin and competitive lists remain bespoke card/list presentations.
- Status badges use multiple page-specific class mappings.
- Empty states remain mostly page-local.
- Navigation icons are text/initial based and do not yet have a shared icon
  abstraction.
- There is no component visual test catalog or browser screenshot suite.

## Recommended Phase 2.1 migration order

1. Add a component catalog with visual and interaction states.
2. Migrate status badges and page-local empty states to Badge/EmptyState.
3. Migrate admin filter controls to the form primitives.
4. Migrate complex match action buttons one workflow at a time with interaction
   tests.
5. Adopt DataTable only for pages where a semantic table improves the existing
   experience without redesigning it.
6. Move remaining repeated legacy literals to tokens after screenshot baselines
   are available.

## Explicit confirmations

- Branding was not changed.
- Business logic was not changed.
- API behavior was not changed.
- Routing was not changed.
- Permissions and authorization behavior were not changed.
- Existing visual language was preserved.
- The application is ready for Phase 2.1.
