# AGENT.md — AURA Clinical Data Library

## 0. Agent Assignment

You are the senior full-stack engineer responsible for building the **AURA Clinical Data Library** as a production-grade web application.

This is **not** a prototype, UI mock, static dashboard, or demo. Build the real application end-to-end with authentication, authorization, database schema, private clinical image storage, auditability, validation, robust error handling, responsive UI, and production deployment readiness.

### Preferred model for this build

**Use Claude Opus 5 for the initial architecture + implementation pass if it is available to you.**

Reason: this project combines medical/clinical data handling, private object storage, signed URLs, RLS, relational data modeling, dynamic metadata, audit trails, image-upload workflows, and a multi-screen production UI. The initial pass benefits more from stronger long-context reasoning and cross-file consistency than from maximum coding speed.

After the architecture and core implementation are stable, Sonnet can be used for smaller isolated follow-up changes, UI refinements, tests, and repetitive implementation tasks.

Do not downgrade architecture, security, or data integrity to save tokens.

---

# 1. Product Goal

Build a secure clinical case library for rhinoplasty cases.

The system stores:

- Clinical case metadata
- Pre-operative photographs
- Follow-up photographs
- Standard clinical image views
- Structured case notes
- Procedure details
- Anatomical changes
- Follow-up observations
- Consent status
- Surgeon/expert review
- Completion status
- Audit history

The system must prioritize:

1. Security
2. Data integrity
3. Consistency
4. Ease of clinical use
5. Fast retrieval
6. Clear case timelines
7. Original image preservation
8. Auditability

The primary visible identifier for a case is:

`RH-0001`, `RH-0002`, `RH-0003`, etc.

However, never use that sequential case number as the internal database primary key or storage security boundary.

Use UUIDs internally.

---

# 2. Locked Technology Stack

Do not replace technologies without explicit approval.

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui

## UI Rule

**Use shadcn/ui components and official shadcn patterns/blocks wherever possible.**

Do not introduce another component library.

Forbidden:

- Material UI
- Ant Design
- Chakra UI
- Mantine
- Bootstrap component library
- PrimeReact
- NextUI/HeroUI
- custom design-system package
- unnecessary third-party UI kits

Utility libraries required by shadcn are acceptable.

TanStack Table is allowed for advanced table behavior because it is the standard approach used with the shadcn Data Table pattern.

Use Lucide icons only through the normal shadcn ecosystem.

## Backend / Database

- Supabase PostgreSQL
- Supabase Auth
- Supabase Row Level Security

## Image/Object Storage

- Tigris Data
- Private S3-compatible bucket
- Presigned upload URLs
- Presigned read URLs

Do NOT use:

- Supabase Storage
- Cloudflare R2
- Trigger.dev
- Redis
- separate Express backend
- separate NestJS backend
- VPS
- Firebase

## Hosting

- Cloudflare for the Next.js application using the currently supported production Next.js deployment path.

Keep the application stateless wherever possible.

---

# 3. High-Level Architecture

```text
Browser
   |
   v
Cloudflare-hosted Next.js
   |
   |---- Supabase Auth
   |
   |---- Supabase PostgreSQL
   |       |
   |       `---- RLS + application authorization
   |
   `---- Tigris Private Object Storage
           |
           |---- presigned PUT/upload
           `---- presigned GET/read
```

Never expose:

- Supabase service role key
- Tigris access key
- Tigris secret key
- database admin credentials

to browser/client-side JavaScript.

Secrets belong only in server environment variables.

---

# 4. Core Clinical Library Structure

Conceptually each case looks like:

```text
RH-0001
|
|-- Case Information
|
|-- BEFORE
|   |-- FRONT
|   |-- RIGHT 45
|   |-- LEFT 45
|   |-- RIGHT PROFILE
|   |-- LEFT PROFILE
|   `-- BASE
|
|-- FOLLOW-UPS
|   |-- 1 MONTH
|   |-- 3 MONTHS
|   |-- 6 MONTHS
|   |-- 12 MONTHS
|   `-- CUSTOM
|
|-- CASE NOTES
|-- CONSENT
|-- EXPERT REVIEW
`-- AUDIT HISTORY
```

Important:

Do NOT model follow-ups internally as only:

- FOLLOW-UP 1
- FOLLOW-UP 2
- FOLLOW-UP 3
- FOLLOW-UP 4

Follow-ups must be real timeline records.

Examples:

- 1 Month
- 3 Months
- 5 Months
- 6 Months
- 12 Months
- 18 Months
- Custom

Store the actual visit/follow-up date and calculate the interval from surgery where possible.

---

# 5. Standard Clinical Views

Default views:

- FRONT
- RIGHT_45
- LEFT_45
- RIGHT_PROFILE
- LEFT_PROFILE
- BASE

The UI labels must display:

- Front
- Right 45°
- Left 45°
- Right Profile
- Left Profile
- Base

These are standard defaults, but the architecture must allow additional view types later without a migration that rewrites all case data.

---

# 6. Critical Requirement — Self-Learning Type-or-Select Dropdowns

This is mandatory.

Many clinical fields must use an editable autocomplete/combobox instead of a fixed Select.

Example: Procedure.

The first time a user creates a case they may type:

`Rhinoplasty`

The app must save that value into the appropriate master-data table.

The next time any authorized user creates/edits a case, typing `Rhi...` must show:

`Rhinoplasty`

as an existing suggestion.

The user can:

1. Select an existing value.
2. Type a new value.
3. Create the new value directly from the dropdown.
4. Reuse it later.

This applies to reusable fields such as:

- Procedure
- Procedure subtype if configured
- Patient concern category
- Anatomical finding terms where appropriate
- Treatment recommendation
- Complication category
- Surgeon-defined tags
- Follow-up label templates
- Other reusable clinical categorization fields

Do NOT force every long narrative field into master data.

Narrative fields such as surgeon assessment and detailed case notes remain free-text.

## Required UX Pattern

Use shadcn:

- Popover
- Command
- CommandInput
- CommandList
- CommandItem
- Button

Behavior example:

```text
Procedure
[ Rhinoplasty                         v ]

Type to search...

Rhinoplasty
Revision Rhinoplasty
Functional Rhinoplasty

+ Create "Preservation Rhinoplasty"
```

If the user creates a new option:

1. Normalize whitespace.
2. Prevent case-insensitive duplicates.
3. Save to the database.
4. Immediately select the saved record.
5. Make it available in future dropdowns.

## Master Data Requirements

Each reusable option should support:

- id UUID
- normalized_key
- display_name
- is_active
- created_by
- created_at
- updated_at
- optional usage_count
- optional sort_order

Never delete a used master-data value just because an admin disables it.

Use `is_active = false` so historical cases continue displaying correctly.

Existing values referenced by old cases remain readable.

---

# 7. Case Number Generation

Cases display sequential identifiers:

```text
RH-0001
RH-0002
RH-0003
...
```

Requirements:

- Internal primary key = UUID.
- `case_number` = unique human-readable identifier.
- Sequence generation must be concurrency-safe.
- Do not calculate `MAX(case_number) + 1` in application code.
- Use a PostgreSQL sequence or transaction-safe database function.

Case number format must be configurable later, but MVP prefix is:

`RH-`

with zero-padded 4 digits minimum.

Examples:

- RH-0001
- RH-0028
- RH-1245

---

# 8. Main Screens

## 8.1 Authentication

Screens:

- Sign in
- Forgot password
- Reset password
- First-time account setup if required

Use Supabase Auth.

No public sign-up.

Users are created/invited by authorized admins.

---

## 8.2 Dashboard

Keep this operational, clean, and clinically useful.

Cards:

- Total Cases
- Active Follow-ups
- Awaiting Expert Review
- Completed Cases
- Incomplete Cases

Sections:

### Recent Cases

Columns:

- Case ID
- Procedure
- Procedure Type
- Surgery Date
- Latest Follow-up
- Completion
- Review Status
- Actions

### Follow-up Attention

Show cases that may require follow-up based on surgery/follow-up history.

Do not turn this into an excessive analytics dashboard.

---

## 8.3 Cases Page

Header:

- `Cases`
- `Create Case` button

Search:

- Case ID
- Procedure
- Tags

Filters:

- Procedure
- Procedure Type
- Surgery date range
- Follow-up availability
- Consent
- Review status
- Completion status
- Case status

Table must use shadcn Data Table patterns.

Columns:

- Case ID
- Procedure
- Type
- Surgery Date
- Latest Follow-up
- Consent
- Completion
- Expert Review
- Status
- Actions

Support:

- server-side pagination
- debounced search
- server-side filters
- sortable columns where useful

Avoid downloading all cases to the browser.

---

## 8.4 Create Case

Required fields:

- Procedure
- Procedure Type
- Date of Surgery

Procedure uses the mandatory self-learning type-or-select combobox.

Procedure Type defaults:

- Primary
- Revision

but model it so more values can be added later if requested.

Additional fields:

- Follow-up availability
- Consent for image use: Yes / No
- Optional tags

On creation:

1. Generate UUID.
2. Generate concurrency-safe RH case number.
3. Write audit event.
4. Redirect to case detail.

Do not require image upload during the initial create transaction.

---

## 8.5 Case Detail

Header contains:

- Case ID
- Procedure
- Procedure Type
- Surgery Date
- Consent Badge
- Completion status
- Review status
- actions menu

Use tabs:

- Overview
- Before
- Follow-ups
- Case Notes
- Consent
- Expert Review
- Audit History

### Overview

Show:

- case information
- completion checklist
- follow-up timeline
- image completeness
- case-note completeness
- consent status
- expert review status

---

# 9. Clinical Image UI

For BEFORE and each follow-up visit, render six standard view cards:

```text
Front              Right 45°          Left 45°
[ image ]          [ image ]          [ image ]

Right Profile      Left Profile       Base
[ image ]          [ image ]          [ image ]
```

Use responsive layouts:

- desktop: 3 columns
- tablet: 2 columns
- phone: 1 column where necessary

Each image card should support:

- empty/upload state
- upload progress
- secure preview
- image metadata
- uploaded date
- uploaded by
- replace action with audit trail
- delete/supersede action according to role
- integrity status where available

Do not expose direct permanent object URLs.

---

# 10. Image Upload Flow

Never proxy large clinical image bytes through an unnecessary long-running app request.

Preferred flow:

```text
Browser
   |
   | request upload authorization
   v
Next.js server
   |
   | validate Supabase session
   | validate role
   | validate case
   | validate visit
   | validate image view
   v
Create short-lived presigned Tigris upload URL
   |
   v
Browser uploads directly to Tigris
   |
   v
Server finalization endpoint
   |
   | verify expected object metadata
   | record database metadata
   | create audit event
   v
Complete
```

Required validation:

- authenticated user
- authorized role
- case exists
- case is not deleted
- visit exists
- MIME type allowed
- extension allowed
- maximum file size
- expected content metadata where possible

Allowed MVP formats should be conservative:

- JPEG/JPG
- PNG
- HEIC/HEIF only if browser/application support is intentionally implemented and tested

Do not pretend HEIC preview works cross-browser if it has not been implemented.

---

# 11. Original Image Integrity

Clinical photographs are originals.

User instruction:

- do not edit
- do not filter
- do not crop
- do not alter

Therefore:

1. Original uploaded object is immutable.
2. Never overwrite an existing object key.
3. Replacement creates a new object.
4. Previous object metadata remains in history.
5. Database marks which image version is current.
6. Record who replaced it and when.
7. Store SHA-256 hash when technically feasible.
8. Store file size.
9. Store MIME type.
10. Store original client filename as metadata, but do not use it as the Tigris object key.

Do not create an image editor.

If later thumbnails are introduced, thumbnails must be derivative objects and must never replace the original.

---

# 12. Tigris Object Keys

Tigris bucket must be PRIVATE.

Do not use predictable public-facing case numbers as the storage security model.

Preferred key:

```text
clinical/{case_uuid}/{visit_uuid}/{image_uuid}/original.jpg
```

Example:

```text
clinical/
  8e8a61df-.../
    1cf7833a-.../
      536a43c3-.../
        original.jpg
```

The database maps that object to:

- RH-0001
- Before
- Front

Never persist an expiring presigned URL in the database.

Persist:

- bucket
- object_key

Generate a new presigned URL when an authorized user needs access.

---

# 13. Secure Image Read Flow

```text
Browser requests image
        |
        v
Next.js server
        |
        | verify Supabase session
        | verify user role
        | verify case authorization
        | verify image belongs to case
        v
Create short-lived Tigris presigned GET
        |
        v
Browser loads image
```

Use short expiry.

Do not expose Tigris credentials.

Do not create permanent public URLs.

---

# 14. Follow-up Model

A case can have zero to many visits.

Visit types:

- BEFORE
- FOLLOW_UP

Only one active BEFORE visit should exist per case in MVP.

Follow-up contains:

- id
- case_id
- visit_type
- visit_date
- display_label
- months_after_surgery numeric/derived where possible
- clinical_observation
- created_by
- created_at
- updated_at

Examples:

```text
1 Month
3 Months
5 Months
6 Months
12 Months
18 Months
Custom
```

The actual visit date is authoritative.

Do not require follow-ups to occur exactly at predefined months.

Provide:

`+ Add Follow-up`

Dialog:

- Visit date
- Suggested interval label
- Editable display label
- Follow-up observation

If visit date and surgery date are known, calculate an approximate interval and suggest a label, but allow correction.

---

# 15. Case Notes — Structured Data

Do not store the entire case note as one monolithic plain-text blob.

Required fields/sections:

## Procedure

- Procedure

## Patient Concern

- Patient concern narrative

## Pre-operative Assessment

- assessment
- treatment recommendation before surgery
- pre-operative aesthetic goal

## Changes Performed

Use an ordered repeatable list.

Example:

1. Dorsal reduction
2. Tip refinement
3. Septal correction

Support add/remove/reorder.

## Specific Anatomical Changes

Fields:

- Dorsum
- Tip
- Projection
- Rotation
- Alar
- Septum
- Other

## Surgeon's Assessment

Long text.

## Outcome

Long text.

## Patient Satisfaction

Long text or structured rating only if explicitly approved later.

## Complications

- complication present: Yes / No
- details
- reusable complication type through type-or-select combobox where useful

## Revision Required

- Yes / No

## Follow-up Observations

Stored against the actual follow-up visit, not duplicated into a static 1M/3M/6M/12M set of columns.

## Dr. Praveen's Final Assessment

Structured expert review field with:

- final assessment
- reviewer
- reviewed_at
- review status

---

# 16. Consent

Consent must be a first-class entity or structured record.

Minimum:

- case_id
- image_use_consent: YES / NO
- recorded_by
- recorded_at
- optional notes
- optional consent document reference in future

Consent status must be visible prominently on case detail.

Do not automatically interpret consent for image use as permission to make the case public.

This application does not include public gallery publishing in MVP.

---

# 17. Completion Checklist

Calculate completion dynamically.

Checklist:

- Before images uploaded
- Required standard views complete or explicitly marked unavailable
- Follow-ups updated
- Case Notes completed
- Consent confirmed
- Expert review completed

The UI should clearly show:

```text
Case Completion
83%

✓ Case information
✓ Before images
✓ Case notes
✓ Consent
○ Follow-up incomplete
○ Expert review pending
```

Do not mark a case complete simply because a percentage threshold is crossed.

`Completed` requires explicit completion rules.

---

# 18. Image Availability

Sometimes one of the six standard views may genuinely be unavailable.

Do not force users to upload a wrong image just to satisfy completion.

Each expected image slot can be:

- UPLOADED
- MISSING
- NOT_AVAILABLE

If NOT_AVAILABLE:

- require an optional/short reason
- record who set it
- audit it

This makes completion meaningful.

---

# 19. Roles and Permissions

MVP roles:

## ADMIN

Can:

- manage users
- create cases
- edit case metadata
- upload images
- manage follow-ups
- edit case notes
- manage consent records
- view audit logs
- archive cases
- manage master data

## SURGEON

Can:

- view authorized cases
- edit clinical assessments
- edit case notes
- create/update final assessment
- review images
- mark expert review complete

## STAFF

Can:

- create cases
- edit allowed case metadata
- upload images
- add follow-ups
- enter case notes
- update operational fields

Cannot manage users/security.

## VIEWER

Read-only.

Can view only cases allowed by policy.

Cannot:

- upload
- modify
- delete
- replace
- edit notes
- change consent

Implement authorization on the server and in database policies.

Hiding a button is not authorization.

---

# 20. Supabase RLS

Enable Row Level Security on every user-accessible clinical table.

Never rely solely on Next.js UI.

At minimum secure:

- cases
- case_visits
- clinical_images
- clinical_image_versions
- case_notes
- case_changes_performed
- case_consents
- case_reviews
- audit_logs
- master-data tables where restricted

Create helper SQL functions if required for role checks.

Avoid recursive RLS policies.

Never expose service-role operations to the client.

Use server-only code for privileged operations.

---

# 21. Suggested Database Schema

Use migrations.

Do not build schema manually only through dashboard clicks.

## profiles

```text
id uuid PK -> auth.users.id
display_name text
role_id uuid
is_active boolean
created_at timestamptz
updated_at timestamptz
```

## roles

```text
id uuid PK
code text UNIQUE
name text
created_at timestamptz
```

Codes:

- ADMIN
- SURGEON
- STAFF
- VIEWER

## cases

```text
id uuid PK
case_number text UNIQUE NOT NULL
procedure_id uuid
procedure_type_id uuid
surgery_date date
status text
archived_at timestamptz null
created_by uuid
created_at timestamptz
updated_at timestamptz
version integer
```

Recommended status values:

- ACTIVE
- COMPLETED
- ARCHIVED

Use appropriate database constraints.

## procedures

Self-learning master table.

```text
id uuid PK
normalized_key text UNIQUE
display_name text
is_active boolean
usage_count integer default 0
created_by uuid
created_at timestamptz
updated_at timestamptz
```

## procedure_types

```text
id uuid PK
normalized_key text UNIQUE
display_name text
is_active boolean
created_by uuid
created_at timestamptz
updated_at timestamptz
```

Seed:

- Primary
- Revision

## case_visits

```text
id uuid PK
case_id uuid FK
visit_type text
visit_date date null
display_label text
months_after_surgery numeric null
clinical_observation text null
created_by uuid
created_at timestamptz
updated_at timestamptz
```

## image_view_types

```text
id uuid PK
code text UNIQUE
display_name text
sort_order int
is_standard boolean
is_active boolean
created_at timestamptz
```

Seed:

- FRONT
- RIGHT_45
- LEFT_45
- RIGHT_PROFILE
- LEFT_PROFILE
- BASE

## clinical_images

Represents the logical image slot/current image.

```text
id uuid PK
case_id uuid FK
visit_id uuid FK
view_type_id uuid FK
availability_status text
current_version_id uuid null
not_available_reason text null
created_at timestamptz
updated_at timestamptz
```

Unique constraint:

```text
(visit_id, view_type_id)
```

## clinical_image_versions

Immutable version records.

```text
id uuid PK
clinical_image_id uuid FK
bucket text
object_key text UNIQUE
original_filename text
mime_type text
file_size bigint
sha256 text null
uploaded_by uuid
uploaded_at timestamptz
superseded_at timestamptz null
superseded_by uuid null
```

## case_notes

```text
id uuid PK
case_id uuid UNIQUE FK
patient_concern text
preop_assessment text
treatment_recommendation text
preop_aesthetic_goal text
dorsum text
tip text
projection text
rotation text
alar text
septum text
other_anatomical_change text
surgeon_assessment text
outcome text
patient_satisfaction text
complications_present boolean
complication_details text
revision_required boolean
created_at timestamptz
updated_at timestamptz
updated_by uuid
version integer
```

## case_changes_performed

```text
id uuid PK
case_id uuid FK
description text
sort_order int
created_by uuid
created_at timestamptz
updated_at timestamptz
```

## case_consents

```text
id uuid PK
case_id uuid FK
image_use_consent boolean
notes text null
recorded_by uuid
recorded_at timestamptz
created_at timestamptz
```

Do not overwrite consent history without retaining auditability.

## case_reviews

```text
id uuid PK
case_id uuid FK
status text
final_assessment text
reviewer_id uuid
reviewed_at timestamptz null
created_at timestamptz
updated_at timestamptz
```

Statuses:

- PENDING
- IN_REVIEW
- COMPLETED

## audit_logs

Append-only.

```text
id uuid PK
actor_user_id uuid
action text
entity_type text
entity_id uuid
case_id uuid null
metadata jsonb
created_at timestamptz
```

Do not give normal client users update/delete permission on audit records.

---

# 22. Additional Self-Learning Master Tables

Do not create hundreds of lookup tables blindly.

Use dedicated master tables for important reusable concepts.

Recommended:

- procedures
- procedure_types
- complication_types
- clinical_tags
- followup_label_presets

If multiple fields share identical semantics, a generic controlled vocabulary table may be used, but avoid creating an untyped junk dictionary.

Every reusable master record requires:

- normalized_key
- display_name
- active state
- timestamps
- creator

---

# 23. Normalization Rules for Learnable Dropdowns

When creating a new value:

Input:

```text
"  Rhinoplasty  "
```

Display:

```text
Rhinoplasty
```

Normalized key:

```text
rhinoplasty
```

Input:

```text
"RHINOPLASTY"
```

must detect the existing normalized key and return the existing record.

Do not create duplicates based on capitalization.

Collapse repeated whitespace.

Do not aggressively rewrite clinically meaningful punctuation.

Use database uniqueness to guarantee correctness under concurrent requests.

---

# 24. Audit Events

Audit at least:

- USER_CREATED
- USER_DISABLED
- CASE_CREATED
- CASE_UPDATED
- CASE_ARCHIVED
- FOLLOWUP_CREATED
- FOLLOWUP_UPDATED
- IMAGE_UPLOAD_STARTED where useful
- IMAGE_UPLOADED
- IMAGE_REPLACED
- IMAGE_MARKED_NOT_AVAILABLE
- IMAGE_ACCESSed only if this logging level is intentionally enabled
- CASE_NOTES_UPDATED
- CONSENT_RECORDED
- CONSENT_CHANGED
- REVIEW_STARTED
- REVIEW_COMPLETED
- MASTER_VALUE_CREATED
- MASTER_VALUE_DISABLED

Audit metadata should be useful but must not carelessly duplicate highly sensitive free-text clinical notes into logs.

Record changed field names and safe before/after values where appropriate.

---

# 25. Concurrency and Lost Updates

Production requirement.

For important editable entities such as case notes, include an optimistic concurrency mechanism.

Example:

`version integer`

When updating:

```sql
WHERE id = :id
AND version = :expected_version
```

Increment version.

If no row is updated:

- show a clear conflict message
- reload latest data
- do not silently overwrite another clinician's work

This matters when two staff members edit the same case.

---

# 26. Validation

Use a shared validation approach, preferably Zod where compatible with the selected stack.

Validate both:

- client-side for UX
- server-side for security

Do not trust browser input.

Examples:

Case:

- surgery date required
- procedure required
- procedure type required

Image:

- allowed type
- allowed size
- valid case
- valid visit
- valid view
- user authorization

Notes:

- enforce reasonable maximum lengths
- trim input
- preserve intentional line breaks

---

# 27. Search

MVP search should prioritize:

- exact/partial Case ID
- Procedure
- Procedure Type
- Tags

Do not expose patient names because patient names are intentionally not part of this library design.

Use indexed searchable columns.

Do not run expensive wildcard scans across every large note field on every keystroke.

Use debounce.

---

# 28. Privacy Rules

The clinical library must use Case IDs.

Do not put patient names, phone numbers, email addresses, addresses, or unrelated personal identifiers into:

- Tigris object keys
- filenames generated by the app
- URLs
- page titles
- logs
- analytics

Do not introduce patient-identification fields unless explicitly requested later.

Never make a case public merely because consent for image use is `Yes`.

Consent and authorization are different concepts.

---

# 29. Clinical Data Safety

This application contains sensitive clinical information.

Implement production-grade technical protections, but do not claim the software is automatically compliant with every medical/privacy regulation.

Operational/legal compliance depends on deployment region, contracts, organization policy, retention policy, incident response, vendor agreements, and applicable law.

The application must at least support:

- authentication
- authorization
- least privilege
- private storage
- short-lived signed access
- auditability
- access revocation
- account disabling
- soft archival
- original image integrity
- secure secret handling

---

# 30. Case Archival and Deletion

Do not hard-delete clinical cases from ordinary UI.

MVP:

- Archive Case
- Restore Case for authorized admins

Archived cases are excluded from default active views.

Hard deletion should not be exposed as a normal action.

If a future retention/purge policy is approved, implement it separately.

---

# 31. UI/UX Requirements

Design language:

- professional
- minimal
- clinical
- spacious
- fast
- neutral
- no decorative gimmicks

Use only shadcn patterns/components.

Avoid:

- gradients everywhere
- oversized hero sections
- marketing-style animations
- glassmorphism
- excessive rounded cards
- excessive shadows
- unnecessary color
- custom UI widgets when shadcn already provides the pattern

Use status color carefully through semantic badges.

## Responsive behavior

Primary usage is desktop, but pages must remain usable on tablets and phones.

Sidebar:

- desktop persistent
- mobile Sheet/drawer

Tables:

- responsive horizontal scrolling or mobile card fallback only where necessary

Image grids must adapt cleanly.

---

# 32. Accessibility

Required:

- semantic labels
- keyboard navigation
- visible focus states
- accessible dialogs
- accessible dropdowns
- alt text for UI context without exposing sensitive identifiers unnecessarily
- no color-only status communication

shadcn/Radix accessibility behavior should be preserved.

Do not break it with custom div-only interactions.

---

# 33. Loading/Error/Empty States

Every screen must have intentional states.

Use shadcn:

- Skeleton
- Alert
- Empty state composition
- Sonner/toast where appropriate

Examples:

Cases empty:

`No cases yet. Create the first clinical case.`

No follow-ups:

`No follow-up visits have been added.`

Missing image:

`No image uploaded`

Access error:

`You do not have permission to access this case.`

Do not expose raw database errors, SQL, stack traces, storage credentials, or internal IDs.

---

# 34. Presigned URL Security

Presigned URLs must be generated server-side.

Read URL request must verify:

- valid authenticated session
- active user
- case access
- image belongs to case
- image is current/allowed version

Upload URL request must verify:

- upload permission
- valid case
- valid visit
- allowed view
- expected content type
- expected file size

Use short-lived signed URLs.

Do not cache private signed URLs in a public CDN cache.

---

# 35. Environment Variables

Use clear server-only names.

Example:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

TIGRIS_ENDPOINT=
TIGRIS_REGION=
TIGRIS_BUCKET=
TIGRIS_ACCESS_KEY_ID=
TIGRIS_SECRET_ACCESS_KEY=
```

Only `NEXT_PUBLIC_*` may reach the browser.

Confirm actual Tigris S3 SDK configuration from the installed/current SDK documentation during implementation.

Never commit `.env*` secrets.

Provide `.env.example` with empty placeholders.

---

# 36. Recommended Project Structure

Use a feature-oriented structure.

Example:

```text
src/
  app/
    (auth)/
    (dashboard)/
      dashboard/
      cases/
        page.tsx
        new/
        [caseId]/
      users/
      settings/
      audit/
    api/
      storage/
      uploads/
      images/

  components/
    ui/                 # shadcn generated components
    app/
      app-sidebar.tsx
      page-header.tsx
      data-table/
    cases/
    clinical-images/
    followups/
    case-notes/

  features/
    auth/
    cases/
    visits/
    images/
    notes/
    consent/
    reviews/
    master-data/
    audit/

  lib/
    supabase/
      client.ts
      server.ts
      admin.ts
    tigris/
      server.ts
      presign.ts
    auth/
    permissions/
    validation/
    utils/

  server/
    actions/
    queries/
    services/

supabase/
  migrations/
  seed.sql
```

Do not put all business logic into React components.

---

# 37. Server / Client Boundaries

Prefer Server Components for page data where appropriate.

Use Client Components only when needed for:

- forms
- dialogs
- comboboxes
- image upload
- interactive table controls
- image viewer interaction

Do not mark entire route trees `use client` unnecessarily.

Sensitive operations must go through server-side code.

---

# 38. API/Action Design

Organize operations around use cases.

Examples:

- createCase
- updateCase
- archiveCase
- createFollowup
- updateFollowup
- getUploadUrl
- finalizeImageUpload
- getImageReadUrl
- replaceClinicalImage
- markImageUnavailable
- updateCaseNotes
- recordConsent
- completeExpertReview
- createMasterValue

Each operation must:

1. Authenticate.
2. Authorize.
3. Validate.
4. Perform transaction where needed.
5. Audit.
6. Return safe result.

---

# 39. Transactions

Use database transactions/functions for operations that must be atomic.

Examples:

- case number generation + case creation
- replacing current clinical image version
- consent state change + audit
- expert review completion + audit

Do not leave half-finished state if one write succeeds and the next fails.

---

# 40. Tigris Upload Finalization

A presigned upload alone is not enough to trust that the database metadata is valid.

Finalization should:

1. receive upload token/context
2. confirm authorized user
3. validate expected object key
4. verify object exists where supported
5. verify size/content metadata where possible
6. calculate/verify checksum strategy if implemented
7. create immutable image version row
8. set current version
9. audit
10. return safe image metadata

Use idempotency so retrying finalization does not duplicate records.

---

# 41. Image Replacement

Never overwrite the same Tigris object.

Replacement flow:

```text
Existing logical image
     |
     | current_version -> version A
     |
Upload new object
     |
     v
version B
     |
transaction:
  mark version A superseded
  set current_version = B
  audit IMAGE_REPLACED
```

Historical metadata remains.

UI should show only current image by default.

Authorized audit/history screen may show replacement history.

---

# 42. Master Data Management

Admin Settings should include:

`Clinical Master Data`

Sections:

- Procedures
- Procedure Types
- Complication Types
- Tags
- Follow-up Label Presets

For each:

- search
- active/inactive
- created date
- usage count where efficient
- rename cautiously
- disable

Do not allow destructive deletion of values already in use.

The type-or-select control should create new values without forcing users to visit Settings first.

---

# 43. Default Seed Data

Seed roles:

- ADMIN
- SURGEON
- STAFF
- VIEWER

Seed procedure types:

- Primary
- Revision

Seed image views:

- FRONT
- RIGHT_45
- LEFT_45
- RIGHT_PROFILE
- LEFT_PROFILE
- BASE

Seed follow-up presets:

- 1 Month
- 3 Months
- 6 Months
- 12 Months

Do not hardcode them into JSX only.

---

# 44. Case Notes Autosave

Do NOT aggressively autosave every keystroke to production clinical notes unless safely debounced and conflict-aware.

Preferred MVP:

- explicit Save button
- dirty-state indication
- warn on navigation with unsaved changes where practical

Optionally debounce drafts locally, but the authoritative write is explicit.

Display:

`Saved at 3:24 PM`

after successful save.

---

# 45. Completion Logic

Example completion function:

## Required for complete case

- procedure exists
- procedure type exists
- surgery date exists
- consent explicitly recorded
- BEFORE visit exists
- six standard BEFORE slots are either UPLOADED or NOT_AVAILABLE
- case notes required sections completed according to approved rules
- expert review COMPLETED

Follow-up completion is contextual.

If follow-up is expected/created, its standard views should also be tracked for completeness.

Do not assume every case must already have 12-month follow-up before it can ever be clinically reviewed.

Represent:

- data completeness
- follow-up maturity

as related but distinct concepts where useful.

---

# 46. Dates and Timezones

Store timestamps as `timestamptz`.

Display dates according to configured clinic locale.

Initial date display:

`DD/MM/YYYY`

Surgery date and visit date are `date` values unless exact time is clinically required.

Do not accidentally shift pure dates due to timezone conversion.

---

# 47. Performance

Design for a small-to-medium clinic first while keeping clean scaling behavior.

Required:

- server-side pagination
- database indexes
- avoid N+1 queries
- do not fetch image binary through database
- direct presigned object upload
- lazy-load images
- do not load all follow-up images at full resolution when tab is not visible
- cache safe master data reasonably
- do not publicly cache patient/clinical content

Suggested indexes:

- cases.case_number
- cases.procedure_id
- cases.procedure_type_id
- cases.surgery_date
- cases.status
- case_visits.case_id
- clinical_images.case_id
- clinical_images.visit_id
- audit_logs.case_id
- audit_logs.created_at
- normalized_key fields

---

# 48. Image Viewer

Use a simple secure clinical image preview.

Features:

- fit-to-screen
- zoom if implemented with lightweight native/browser behavior
- previous/next among current visit views
- view label
- metadata

Do not add image editing controls.

No:

- crop
- filters
- brightness editing
- retouch
- annotations that mutate original

If annotations are ever added later, store them as separate metadata/overlay entities.

---

# 49. User Management

Admin page:

- list users
- invite/create user
- role
- active/inactive
- last sign-in if available
- disable access

No public registration.

When user is disabled, server authorization must deny clinical access even if an old session still exists where practical.

Use Supabase Auth admin functions only server-side.

---

# 50. Audit Log UI

Admin-accessible.

Filters:

- date range
- user
- action
- case
- entity type

Columns:

- Timestamp
- User
- Action
- Case
- Entity
- Details

Do not display secrets or raw clinical content in audit details.

---

# 51. Security Checklist

Before calling the app production-ready, verify:

- [ ] No service keys in browser bundle
- [ ] Tigris bucket private
- [ ] No permanent image URLs
- [ ] Presigned read URLs require authorization
- [ ] Presigned upload URLs require authorization
- [ ] RLS enabled and tested
- [ ] RLS deny tests included
- [ ] No public sign-up
- [ ] Roles enforced server-side
- [ ] Audit log append-only for normal users
- [ ] Archived cases restricted correctly
- [ ] Input validation server-side
- [ ] Upload MIME/size validation
- [ ] Original object never overwritten
- [ ] Replacements versioned
- [ ] SQL migrations committed
- [ ] Environment secrets excluded from git
- [ ] Error responses sanitized
- [ ] Production security headers reviewed
- [ ] Authentication/session handling tested
- [ ] Dependency vulnerabilities reviewed

---

# 52. Testing Requirements

Use meaningful tests.

## Unit tests

- case number formatting
- normalized master value generation
- duplicate master-value handling
- completion calculation
- role permission helper
- follow-up interval calculation

## Integration tests

- create case
- create new Procedure from combobox
- subsequent case sees saved Procedure
- upload authorization denied for VIEWER
- image read denied without authorization
- image replacement creates new version
- old version retained
- consent change audited
- review completion audited
- archived case behavior

## RLS/security tests

Explicitly test that:

- unauthenticated user cannot select clinical tables
- VIEWER cannot update
- STAFF cannot perform admin-only actions
- users cannot bypass object access by guessing UUIDs
- disabled/inactive access is rejected according to policy

## E2E tests

Critical path:

1. Admin signs in.
2. Creates RH case.
3. Types new procedure.
4. New procedure is saved.
5. Uploads Before/Front.
6. Adds other standard views.
7. Creates 1-month follow-up.
8. Uploads follow-up images.
9. Completes case notes.
10. Records consent.
11. Surgeon completes final assessment.
12. Completion state updates.
13. Viewer can read but cannot edit.

---

# 53. No Fake Data in Production Paths

Seed development data separately.

Do not hardcode fake case metrics into dashboard components.

Dashboard metrics must come from real database queries.

Loading states should not display fake patient/case records.

---

# 54. Error Recovery

Image upload must tolerate:

- network interruption
- expired presigned URL
- duplicate finalize request
- browser refresh after upload
- object upload succeeds but metadata finalize temporarily fails

Use an upload session/idempotency mechanism where practical.

Do not silently orphan objects indefinitely.

Provide a controlled cleanup strategy for unfinalized uploads.

---

# 55. Production Logging

Log operational errors server-side.

Never log:

- Tigris secret
- Supabase service key
- session tokens
- signed URLs in full
- entire case-note bodies by default
- raw image bytes

Use request correlation IDs where helpful.

---

# 56. Navigation

Desktop sidebar:

- Dashboard
- Cases
- Users & Access (Admin)
- Audit Logs (Admin)
- Settings (Admin)

User menu:

- Profile
- Sign out

Case detail navigation stays within tabs rather than exploding sidebar items.

---

# 57. shadcn Components to Prefer

Use installed/current shadcn components where applicable:

- Alert
- AlertDialog
- Avatar
- Badge
- Breadcrumb
- Button
- Calendar
- Card
- Checkbox
- Command
- Dialog
- DropdownMenu
- Form
- Input
- Label
- Pagination
- Popover
- Progress
- RadioGroup
- ScrollArea
- Select
- Separator
- Sheet
- Sidebar
- Skeleton
- Sonner
- Switch
- Table
- Tabs
- Textarea
- Tooltip

Use official shadcn blocks/patterns as starting points when available.

Do not copy an entire unrelated dashboard template and force the clinical workflow into it.

---

# 58. Type-or-Select Component Contract

Create a reusable application component based entirely on shadcn primitives.

Suggested API:

```ts
<TypeOrCreateCombobox
  label="Procedure"
  value={procedureId}
  onValueChange={setProcedureId}
  searchAction={searchProcedures}
  createAction={createProcedure}
  placeholder="Select or type a procedure"
  createPermission="master_data:create"
/>
```

Required behavior:

- keyboard accessible
- search existing values
- case-insensitive matching
- create new
- loading state
- duplicate detection
- disabled state
- error state
- immediately select created value
- no accidental create on empty/whitespace
- Enter behavior clearly defined
- Escape closes
- supports active existing values
- if editing historical record with inactive selected value, show it but do not suggest it for new selection by default

This component is core to the app.

---

# 59. Case Status vs Completion

Do not confuse:

- operational status
- data completion
- expert review status

Example:

```text
Status: ACTIVE
Completion: 83%
Expert Review: PENDING
```

A case may be ACTIVE and 100% complete for its current stage.

Do not overload one enum.

---

# 60. Clinical Timeline

Case Overview should show a timeline:

```text
Surgery
12/01/2026

Before
Images complete

1 Month
14/02/2026
Images complete

3 Months
16/04/2026
Images incomplete

6 Months
Not yet added
```

Use visit data.

Do not pre-create dozens of empty follow-up database rows unless there is a clear reason.

---

# 61. Follow-up Suggested Labels

When user adds a follow-up:

Surgery date:

`12/01/2026`

Visit date:

`14/04/2026`

System can suggest:

`3 Months`

But preserve actual date.

If visit does not closely match a preset:

`5 Months`

or custom label.

The label is presentation metadata; the dates are authoritative.

---

# 62. Image Consent UI

Show consent badge clearly:

- Consent Confirmed — Yes
- Consent Confirmed — No
- Consent Not Recorded

Do not use only two states if absence is possible.

Database should distinguish:

- yes
- no
- not yet recorded

Do not default missing consent to `No` silently.

---

# 63. No Patient Name Requirement

The initial requirements explicitly prioritize Case ID instead of patient personal identifiers.

Therefore do not add:

- patient name
- phone
- email
- address
- DOB

to the MVP unless explicitly requested.

If a future requirement adds patient identification, handle it as a separate security/privacy change.

---

# 64. Expert Review

Case review flow:

```text
PENDING
   |
   v
IN_REVIEW
   |
   v
COMPLETED
```

Surgeon can:

- enter final assessment
- mark completed

Store:

- reviewer
- timestamp
- assessment
- status

If final assessment is edited after completion:

- audit the edit
- retain update history/version if practical
- optionally return review to IN_REVIEW depending on chosen workflow

For MVP, keep the behavior explicit and documented.

---

# 65. Case Notes Version/Audit Strategy

At minimum:

- updated_by
- updated_at
- version
- audit event

For stronger traceability, optionally use a case note revisions table.

Do not silently overwrite without knowing who changed the note.

---

# 66. Data Export

Do not build bulk clinical export in MVP unless explicitly requested.

If a download action for an individual image is added:

- require authorization
- obtain fresh presigned URL
- audit if policy requires

Do not create public ZIP links.

---

# 67. Non-Goals for MVP

Do not add these unless explicitly requested:

- AI diagnosis
- AI aesthetic scoring
- facial recognition
- public before/after gallery
- social sharing
- image editing
- image beautification
- automated clinical recommendations
- billing
- appointment scheduling
- EMR integration
- WhatsApp
- SMS
- email campaigns
- mobile native app
- Redis
- background job platform
- Trigger.dev

Keep scope focused.

---

# 68. Implementation Order

Follow this order.

## Phase 1 — Foundation

1. Initialize Next.js + TypeScript.
2. Configure Tailwind.
3. Initialize shadcn/ui.
4. Set up Cloudflare-compatible production configuration.
5. Configure Supabase clients.
6. Add environment validation.
7. Create database migrations.
8. Seed roles/master values.
9. Implement auth.
10. Implement authorization helpers.
11. Implement RLS.

Do not build all UI before security/data model exists.

## Phase 2 — Core Cases

1. Sidebar/layout.
2. Dashboard shell.
3. Cases table.
4. Create Case.
5. concurrency-safe RH case numbering.
6. Case detail.
7. Master-data type-or-select system.

## Phase 3 — Visits

1. Before visit.
2. Follow-up creation.
3. Timeline.
4. standard clinical view slots.
5. completion logic.

## Phase 4 — Tigris Images

1. private S3 client.
2. upload authorization.
3. direct presigned upload.
4. finalize upload.
5. signed read.
6. secure image cards.
7. replacements/versioning.
8. image integrity metadata.

## Phase 5 — Clinical Notes

1. structured notes form.
2. changes performed repeatable list.
3. anatomical fields.
4. optimistic concurrency.
5. save/audit.

## Phase 6 — Consent & Review

1. consent record.
2. expert review.
3. completion calculation.
4. case close/completion UX.

## Phase 7 — Admin

1. users.
2. master data.
3. audit logs.
4. archive/restore.

## Phase 8 — Hardening

1. security tests.
2. RLS tests.
3. E2E.
4. upload failure recovery.
5. responsive QA.
6. accessibility QA.
7. production deployment.
8. security review.

---

# 69. Acceptance Criteria

The MVP is not complete until all of the following work:

## Authentication

- Admin can sign in.
- Unauthorized visitors cannot access app.
- Public registration unavailable.

## Cases

- Admin/Staff creates case.
- System generates RH-XXXX.
- Case list updates.
- Search/filter works.

## Self-learning Dropdown

- User types a previously unseen Procedure.
- Can create it from dropdown.
- Value is persisted.
- A later case shows it as a suggestion.
- Case-insensitive duplicate is prevented.

## Before Images

- Six standard slots render.
- User can securely upload.
- Viewer sees images only while authorized.
- Object bucket remains private.

## Follow-ups

- User adds actual follow-up date.
- System suggests interval.
- User can correct label.
- Follow-up receives the same standard image slots.

## Images

- Upload does not require public bucket.
- Signed URL expires.
- Permanent signed URL is not persisted.
- Replacement creates a new object/version.
- Old metadata is retained.
- Unauthorized read request is denied.

## Notes

- Structured note sections save.
- Changes Performed supports multiple ordered entries.
- Concurrent update does not silently overwrite.

## Consent

- Yes/No/Not recorded clearly distinguishable.
- Change audited.

## Expert Review

- Surgeon enters Dr. Praveen's final assessment.
- Review can be completed.
- Reviewer/time stored.

## Completion

- Checklist reflects real data.
- Missing images visible.
- `NOT_AVAILABLE` can be used with reason.
- Expert review required according to rules.

## Audit

- Key changes create audit events.
- Normal users cannot alter audit history.

## UI

- shadcn/ui only.
- Responsive.
- No third-party component framework.
- Clear loading/error/empty states.

---

# 70. Deliverables

The coding agent must deliver:

1. Complete working source code.
2. Supabase SQL migrations.
3. Seed script/data.
4. `.env.example`.
5. Tigris integration.
6. Cloudflare deployment configuration.
7. Authentication.
8. RLS policies.
9. Role authorization.
10. Case CRUD.
11. Self-learning dropdown system.
12. Follow-up system.
13. Secure clinical image upload/view.
14. Image versioning.
15. Structured case notes.
16. Consent.
17. Expert review.
18. Audit logs.
19. Master-data admin.
20. Tests.
21. README with local setup and deployment steps.

---

# 71. Definition of Done

Do not say "done" because the screens render.

Done means:

- migrations apply from a clean database
- seed runs
- sign-in works
- roles work
- RLS works
- unauthorized requests fail
- cases persist
- RH number generation is safe
- self-learning dropdown persists new values
- Tigris upload works
- private image read works
- image URLs expire
- image replacement versions correctly
- follow-ups work
- notes persist safely
- consent persists
- review persists
- audit works
- tests pass
- production build passes
- Cloudflare deployment succeeds
- no secrets are committed
- there are no obvious TypeScript errors
- no placeholder mock data remains in production code paths

---

# 72. Agent Working Rules

1. Do not ask for confirmation for routine implementation decisions already specified here.
2. Make sensible production-grade decisions within this specification.
3. Do not remove a requirement just because it is harder.
4. Do not introduce a new technology without need.
5. Do not replace shadcn with another component library.
6. Do not make Tigris bucket public.
7. Do not weaken RLS to get the app working.
8. Do not use the service role key in the browser.
9. Do not hardcode fake data.
10. Do not use sequential case IDs as object keys.
11. Do not hard-delete clinical originals.
12. Do not overwrite clinical image objects.
13. Do not store presigned URLs in the database.
14. Do not store all case notes in one unstructured field.
15. Do not hardcode only four follow-up slots.
16. Do not create duplicate dropdown master values.
17. Run lint/typecheck/tests frequently.
18. Keep changes coherent across schema, types, server actions, and UI.
19. Prefer simple, maintainable production code over clever abstractions.
20. Treat clinical information as sensitive data throughout the implementation.

---

# 73. Initial Clinical Case Note Template

The structured UI must cover this source requirement:

```text
Case ID: RH-0001
Procedure: Rhinoplasty
Procedure type: Primary / Revision
Date of surgery: DD/MM/YYYY
Follow-up available: 1M / 3M / 6M / 12M
Consent for image use: Yes / No

RH-0001 — CASE NOTES

1. Procedure:
Primary Rhinoplasty

2. Patient concern:
...

3. Pre-operative assessment:
...

A. Treatment recommendation before surgery
...

B. Pre-operative aesthetic goal
...

4. Changes performed:
1.
2.
3.
4.

5. Specific anatomical changes:
- Dorsum:
- Tip:
- Projection:
- Rotation:
- Alar:
- Septum:
- Other:

6. Surgeon's assessment:
...

7. Outcome:
...

8. Patient satisfaction:
...

9. Complications:
...

10. Revision required:
Yes / No

11. Follow-up:
Actual follow-up visits and observations

12. Dr. Praveen's Final assessment:
...
```

Do not reproduce numbering errors from the source UI; present a clean structured interface.

---

# 74. Original Operational Instructions to Preserve

The product must enforce or support these operational expectations:

## Create Case

Create one unique case ID for every patient.

## Upload Images

Upload images to the correct clinical phase/visit.

## Standard Views

Where available, maintain:

- Front
- Right 45°
- Left 45°
- Right Profile
- Left Profile
- Base

## Follow-up

Label follow-ups according to actual elapsed time after surgery.

## Case Notes

Record:

- patient concern
- aesthetic goal
- pre-operative assessment
- recommended procedure/reason
- changes performed
- anatomical changes
- surgeon assessment
- outcome
- patient satisfaction
- complications
- revision requirement
- follow-up observations

## Consistency

Use the same structure for every case.

## Image Quality

Preserve clear original images.

Do not edit/filter/crop/alter clinical originals.

## Privacy

Use Case ID in the library.

Do not put patient names/personal identifiers into image filenames.

## Completion

Before closing a case confirm:

- images uploaded
- follow-ups updated
- case notes completed
- consent confirmed
- expert review completed

---

# 75. Final Architecture Decision

This is the locked MVP architecture:

```text
Next.js + TypeScript
        |
        +-- Tailwind CSS
        |
        +-- shadcn/ui ONLY
        |
        v
Cloudflare Hosting
        |
        +----------------------+
        |                      |
        v                      v
Supabase                  Tigris Data
Auth                      Private Images
PostgreSQL                S3-compatible
RLS                       Presigned URLs
Clinical Metadata         Originals
Audit Logs                Versioned Objects
```

No Trigger.dev.
No Redis.
No Supabase Storage.
No R2.
No additional UI framework.

Build the application according to this document unless an explicit later instruction changes a requirement.
