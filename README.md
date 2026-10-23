# Native Bed Planner

A personal web app that turns an aerial, a few photos and two or three tape measurements into an installer-ready native planting plan, then renders the bed month by month.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY and GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Everything works without keys: the agent draft and design review fall back to a built-in heuristic planner, and the Renders tab shows the prompt each render would use.

| Variable | Used for | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Agent draft and design review with Claude | heuristic planner |
| `PLANNER_MODEL` | Claude model for planning | `claude-opus-5-5` |
| `PLANNER` | Force `heuristic` or `claude` | auto |
| `GEMINI_API_KEY` | Month renders with Gemini image editing | prompt preview only |
| `GEMINI_IMAGE_MODEL` | Gemini image model | `gemini-2.5-flash-image` |
| `DB_BACKEND` | `sqlite` or `supabase` for data and uploaded files | `supabase` if `SUPABASE_URL` and a secret key are set, else `sqlite` |
| `DATA_DIR` | SQLite db, uploaded aerials and photos, cached renders | `./var`, or the OS temp folder if that isn't writable |
| `SUPABASE_URL` | Supabase project URL | none |
| `SUPABASE_SECRET_KEY` | Server-only secret key (`SUPABASE_SERVICE_ROLE_KEY` also works) | none |
| `SUPABASE_TABLE_PREFIX` | Prefix for the app's tables in a shared project | `bed_planner_` |
| `SUPABASE_BUCKET` | Private storage bucket for uploads and renders | `bed-planner` |
| `APP_PASSWORD` | Password for every page and API route (any username). Required on Vercel. | none locally |

## Storage backends

The app runs on **SQLite** (a local file, the default) or **Supabase** (Postgres + Storage). Switch with `DB_BACKEND=sqlite|supabase`; the rest of the app doesn't change.

Vercel's disk is temporary, so deploy with Supabase. It shares an existing project: every table is prefixed `bed_planner_` and files live in a private `bed-planner` bucket.

1. In your Supabase project, open the SQL editor and run `supabase/migrations/20261023000000_bed_planner.sql` (safe to re-run).
2. Copy the project URL and a secret key (Project Settings → API Keys) into `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Vercel (and `.env.local` to try it locally).
3. Redeploy. To go back to SQLite, set `DB_BACKEND=sqlite` or remove the Supabase variables.

The secret key bypasses row level security and is only used on the server. The tables have RLS on with no policies, so the public key can't read them. Data doesn't migrate between backends automatically.

## Workflow

1. **Project**: create a project, upload an aerial screenshot (north up), calibrate the scale by clicking both ends of something you measured, then trace the house, walks, driveway, trees and each bed. You can also create a bed by its dimensions without an aerial.
2. **Site & start**: set the bed's orientation, sun hours, soil and moisture, add street photos, then pick a starting point:
   - **Agent draft**: shows a missing-info checklist (each item says why it matters), then drafts zones and drifts with a rationale per zone.
   - **Starter templates**: hot dry foundation bed, shady pocket, pollinator border, low walk edge, rain garden. Each scales to the outline and fills its slots with plants that suit the site.
   - **Blank**.
3. **Edit**: drag drifts and vertices, add points, round corners, add drifts by clicking or drawing, swap plants from a list filtered by sun, tier and bloom window, resize to a target count, mark existing plants keep or remove, draw zones with their own sun and moisture. Counts update live; undo and redo with Ctrl+Z and Ctrl+Shift+Z; save a version with Ctrl+S (autosaves after 20 s idle). The aerial shows underneath with an opacity slider.
4. **Plan sheet**: north arrow, scale bar, title block, drifts labeled with code and count (e.g. `ASC-TUB 5`), optional circles at mature spread, edge dimensions, keep/remove callouts and the plant schedule.
5. **Bloom**: a month slider recolors the plan by what is in flower, a bloom calendar, and warnings for gaps by end of the bed (e.g. "Nothing blooms in April at the south end").
6. **Review**: runs the deterministic checks (height order, bloom gaps, lone plants, overlaps, drifts past the edge, site fit, keep plants covered, coverage, species count, palette). With Claude configured, the agent turns them into suggestions and adds judgment calls. Every suggestion is numbered on the plan and applies or dismisses in one tap.
7. **Renders**: May, July, September and January from the street photo (or overhead), cached per plan version and month, labeled illustrative.
8. **Export**: plan sheet PDF (plan view, legend and schedule) and plant list CSV grouped by pot size, per bed or for the whole project.

## Architecture

- **Next.js App Router + React**, plan drawn as SVG. `src/lib/sheet.ts` builds a plan sheet as drawing primitives once; React renders them on screen and `src/lib/export/svg.ts` renders the same primitives to an SVG string for the PDF. One plan JSON feeds every output.
- **State**: Zustand editor store with snapshot undo/redo (`src/store/editor.ts`).
- **Data**: `src/lib/db/repo.ts` is the only module the app uses for persistence. It delegates to a `Backend` (`backend.ts`): SQLite via Drizzle (`sqlite.ts`) or Supabase via `supabase-js` (`supabase.ts`, tables in `supabase/migrations`). Projects carry a nullable `userId`. Uploaded files sit behind a `FileStore` interface (`src/lib/storage.ts`): local disk or Supabase Storage, always served through `/api/files/...`.
- **Geometry** (`src/lib/geometry.ts`): feet relative to each bed's origin, x east and y south. Shoelace area, Chaikin smoothing for curves, polygon clipping. Drift count = area / spacing² × 1.15 for staggered rows.
- **Plant library**: `data/plants.json` (72 Southeast Michigan natives) behind the `PlantLibrary` interface in `src/lib/plants`.
- **Design rules**: `data/design-rules.json` (tier heights, drift sizes, bloom window, overlap and coverage thresholds), not hard-coded.
- **Templates**: `data/templates.json`, drift patterns as fractions of the bed (u end to end, v back to front).
- **Plan versions** are immutable snapshots. Edits, template starts, agent drafts and applied suggestions each create a version. Suggestions store their fix as a plan diff (`PlanOp[]`).
- **Agent** (`src/lib/agent`): a `Planner` interface with a Claude implementation (typed tools: read project state, search plants, request missing info, validate plan, submit plan) and the offline heuristic. Agent output is JSON validated on the server: library-only plants, site fit, overlaps, height order. Claude calls use the server-side refusal fallback (`fallbacks: "default"`).
- **Renders** (`src/lib/render`): a `RenderProvider` interface with a Gemini implementation; the prompt builder describes each zone's plants, heights and what is in bloom that month.

## Scripts

```bash
npm test          # unit tests (geometry, counts, checks, templates, agent validation, exports)
npm run typecheck
npm run build
```

## Notes

- The plant library is a draft compiled for planning. Check nativity, sizes and bloom times against Michigan Flora and Wildtype before ordering.
- Accuracy target is about 6 in; this isn't CAD.
