# DentaStock

DentaStock is a bilingual (English/Spanish), responsive dental-clinic inventory app built with Next.js, Supabase and PostgreSQL.

## Supabase setup

1. Configure the Supabase project URL and publishable key:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `DEEPSEEK_API_KEY` (server-only key for the official DeepSeek API; never use a `NEXT_PUBLIC_` prefix)
   - `NVIDIA_NIM_API_KEY` (server-only NVIDIA NIM fallback key; never use a `NEXT_PUBLIC_` prefix)
   - `EXA_API_KEY` (server-only secret for Exa web-search fallback; never use a `NEXT_PUBLIC_` prefix)
   - `GEMINI_API_KEY` (server-only Google AI Studio key; never use a `NEXT_PUBLIC_` prefix)
2. Enable **Confirm email** in Supabase Auth.
3. Apply the SQL scripts in order on a fresh database:
   `scripts/001_schema.sql`, `scripts/002_rls_policies.sql`, `scripts/003_clinics_catalog_support.sql`, `scripts/004_clinic_invitation_hardening.sql`, `scripts/005_product_categories_and_presentations.sql`.
   If scripts `001` through `004` are already applied, apply only `005`.
4. Add `remgoficial@gmail.com` as the administrator account and confirm its email. Admin access is checked against the authenticated Supabase account email in the database; do not assign admin privileges to another profile manually.
5. Clinic owners can invite staff from **Profile → Clinic team**. This requires a server-only `SUPABASE_SERVICE_ROLE_KEY` so the server can send Supabase Auth invitations. Never expose this key through a `NEXT_PUBLIC_` variable or browser code.

The third and fourth SQL scripts create the per-clinic membership model, product and brand catalogs, support reports, storage bucket, row-level/storage policies and hardened one-time team invitations. Each clinic's inventory and support reports are private to clinic members. The approved global catalog is shared across clinics. Private images are stored in the `inventory-images` bucket with clinic-scoped paths.

## Product behavior

- The home screen totals stock units for the user's primary clinic; the molar distribution is grouped by category.
- Inventory supports name/barcode search, one or more categories per item, category/status filters, item details, edits and quantity adjustments.
- Products can be tracked as individual items, sets or boxes; the selected presentation is reflected with the available quantity.
- The add-item form can scan a barcode with the device camera or accept a typed barcode; camera access requires HTTPS and browser permission. Approved product details, categories, presentation and images are reused unless the clinic uploads its own image.
- Product lookup checks the approved Supabase catalog first. If there is no match, an authenticated server endpoint tries the official DeepSeek API using `deepseek-flash`, then falls back to NVIDIA NIM's `deepseek-ai/deepseek-v4.1-flash` if the official call fails or returns unusable data. Exa web search runs in parallel; Google's `gemini-3.8-flash` then synthesizes the available model and web results. If a provider fails, the others continue; staff must confirm a suggestion before form fields are filled.
- Exa searches product names/barcodes in web sources and includes source links for verification; Exa does not analyze uploaded photos. Photo recognition uses NVIDIA NIM first and Gemini as fallback when NIM is unavailable or fails. Official DeepSeek is used for text-based product suggestions. Configure `DEEPSEEK_API_KEY`, `NVIDIA_NIM_API_KEY`, `EXA_API_KEY`, and `GEMINI_API_KEY` to enable every provider; keep all keys server-only.
- When needed, product photos may be sent to NVIDIA or Google for recognition; product query details may be sent to DeepSeek, NVIDIA, or Google for suggestions. Exa receives text search terms and returns web evidence. AI/model suggestions and web results should be checked before saving; no provider retrieves an official photo for the form.
- Uploaded photos sent for AI identification are not persisted by the lookup endpoint; the browser image upload is used only if the user later saves the inventory item.
- Accounts can update their clinic profile, request an email change, change a password, invite clinic staff and send support reports with screenshots.
- Only the confirmed `remgoficial@gmail.com` account receives the admin navigation and database-level admin permissions.
- Page and form copy is maintained in `messages/en.json` and `messages/es.json`.

Animated UI icons are adapted from [ItsHover](https://www.itshover.com/icons), specifically its home, layers, scan-barcode, user, message-circle, shield-check, magnifier, triangle-alert and X icons. The components are consolidated in `components/icons/animated-icons.tsx`; their Apache 2.0 license is included in `third-party/ITS-HOVER-LICENSE.txt`.
