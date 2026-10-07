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
   `scripts/001_schema.sql`, `scripts/002_rls_policies.sql`, `scripts/003_clinics_catalog_support.sql`, `scripts/004_clinic_invitation_hardening.sql`, `scripts/005_product_categories_and_presentations.sql`, `scripts/006_resolved_report_replies.sql`, `scripts/007_support_reply_notifications.sql`, `scripts/008_inventory_product_conditions.sql`, `scripts/009_product_photo_and_clinic_brands.sql`, `scripts/010_search_indexes_and_brand_normalization.sql`, and `scripts/011_accent_insensitive_search.sql`.
   On an existing database, apply whichever later scripts have not already been run.
4. Add `remgoficial@gmail.com` as the administrator account and confirm its email. Admin access is checked against the authenticated Supabase account email in the database; do not assign admin privileges to another profile manually.
5. Clinic owners can invite staff from **Profile → Clinic team**. This requires a server-only `SUPABASE_SERVICE_ROLE_KEY` so the server can send Supabase Auth invitations. Never expose this key through a `NEXT_PUBLIC_` variable or browser code.

The third and fourth SQL scripts create the per-clinic membership model, product and brand catalogs, support reports, storage bucket, row-level/storage policies and hardened one-time team invitations. Each clinic's inventory and support reports are private to clinic members. The approved global catalog is shared across clinics. Private images are stored in the `inventory-images` bucket with clinic-scoped paths.

## Product behavior

- The home screen totals stock units for the user's primary clinic; the molar distribution is grouped by category.
- Inventory supports accent-insensitive name/barcode search, one or more categories per item, searchable category selection, category/status filters, item details, edits and quantity adjustments. Clinic inventory can track products as new, opened, used, defective or missing.
- Inventory and admin product, clinic-item and user lists are paginated; inventory search and filters run in the database.
- Products can be tracked as individual items, sets or boxes; the selected presentation is reflected with the available quantity.
- The add-item form can scan a barcode with the device camera or accept a typed barcode; camera access requires HTTPS and browser permission. Approved product details, categories, presentation and images are reused unless the clinic uploads its own image.
- Product searches use one sequence across the approved catalog, six pharmacies, Amazon, AliExpress, Alibaba, Blue Dental Venezuela, DYM Students and Dentaltix, then AI. Search results offer up to three suggestions per source type with any available product photos; product images selected from a result are copied into the clinic's private inventory storage. Pharmacy product-page results are matched and ranked, and the highest-ranked pharmacy match pre-fills the form while alternatives remain available for selection. Users can search by product name or barcode and take a photo with the device camera or choose one from storage.
- Admins can analyze a selected package photo in the admin catalog form to extract visible product name, description, barcode, category, type, model/reference, color, brand and presentation; the extracted fields can be corrected before saving. Ordinary clinic users can upload product photos to inventory but cannot invoke image analysis. Text search suggestions marked as incorrect are remembered for that clinic and excluded from later searches for the same query.
- Inventory photos are served through an authenticated, user-scoped URL and use private browser caching with lazy image loading to avoid regenerating signed URLs and eagerly fetching every image on each refresh. New brands are clinic-only until an admin promotes them to the global brand list.
- Product lookup uses one action that checks the approved Supabase catalog, then checks pharmacy catalogs for an exact barcode match, and only then falls back to AI/web suggestions. Generic pharmacy search-page titles are never treated as product data. The authenticated AI endpoint tries the official DeepSeek API using `deepseek-flash`, falls back to NVIDIA NIM's `deepseek-ai/deepseek-v4.1-flash` when needed, and uses Exa/Gemini for web evidence and synthesis. Staff must confirm a suggestion before form fields are filled.
- Exa searches product names/barcodes in web sources and includes source links for verification; Exa does not analyze uploaded photos. Photo recognition uses NVIDIA NIM first and Gemini as fallback when NIM is unavailable or fails. Official DeepSeek is used for text-based product suggestions. Configure `DEEPSEEK_API_KEY`, `NVIDIA_NIM_API_KEY`, `EXA_API_KEY`, and `GEMINI_API_KEY` to enable every provider; keep all keys server-only.
- Admin image analysis sends the selected photo to NVIDIA or Google when configured; DeepSeek can provide a text-only fallback. Product query details may be sent to DeepSeek, NVIDIA, or Google for suggestions. Exa receives text search terms and returns web evidence. AI/model suggestions and web results should be checked before saving; no provider retrieves an official photo for the form.
- Uploaded photos sent for AI identification are not persisted by the lookup endpoint; the browser image upload is used only if the user later saves the inventory item.
- Accounts can update their clinic profile, request an email change, change a password, invite clinic staff and send support reports with screenshots.
- Only the confirmed `remgoficial@gmail.com` account receives the admin navigation and database-level admin permissions.
- Admins can inspect clinic inventory, correct user-created product details and add them to the shared catalog. Support replies from admins are counted in the support navigation until a clinic member opens the conversation.
- Page and form copy is maintained in `messages/en.json` and `messages/es.json`.

Animated UI icons are adapted from [ItsHover](https://www.itshover.com/icons), specifically its home, layers, scan-barcode, user, message-circle, shield-check, magnifier, triangle-alert and X icons. The components are consolidated in `components/icons/animated-icons.tsx`; their Apache 2.0 license is included in `third-party/ITS-HOVER-LICENSE.txt`.
