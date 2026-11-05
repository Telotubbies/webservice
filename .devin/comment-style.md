# Comment & file-organization standard

Applies to every source file in this repo. Two jobs per file: (a) the file
explains itself, (b) the file's internal order reads top-to-bottom.

## Voice

- Explain **why**, never restate what the code already says. Good comments
  carry rationale, invariants, constraints, edge cases, and pointers to the
  decision docs (`CONTRACT.v2`, `ADR-*`, `ISA-*`, doc numbers).
- Write in **this project's own voice**. Describe what the code does for this
  system. Do not claim the code is, follows, or imitates any external product
  or company. (Exception: files under `SDLC/datadog/` and `scripts/dd-*` are
  design-research tooling — they may describe that purpose honestly.)
- Complete sentences, initial capital, trailing period. No telegraphic
  fragments.
- Comments sit immediately above the code they describe. When code changes,
  its comments change.

## Per-language form

| Files | Form |
|---|---|
| `.ts`, `.tsx`, `.js`, `.mjs` | File header: `//` block, 1–3 lines. Exported/public API: `/** */` JSDoc. Implementation notes: `//`. Section banners: `// ── Name ──`. |
| `.py` | Module docstring first line (after shebang/encoding/`from __future__`), one line preferred. Public functions/classes get a docstring only when intent isn't obvious. Notes: `#`. Banners: `# ── Name ──`. |
| `.sql` (migrations) | `-- ` header block: what the migration adds and why (the filename gives the when). Never reorder statements — order is semantics. |
| `.sh`, `Dockerfile`, `Makefile`, `.conf`, `.yml`, `.yaml`, `.ini`, `.toml`, `.env*`, `.gitignore`, `.gitattributes` | `#` header + `#` notes on non-obvious lines. Keep shebang/`syntax=`/`FROM` first where required. |
| `.html` | `<!-- -->` comments only. |
| `.css` | `/* */` header + section banners. |
| `.mmd` (mermaid) | `%%` comments only. |
| `.txt` | `#` header only if the file is config-like (e.g. `requirements.txt`). Skip prose/license assets. |

**Never comment, never reorder:** `.json`, lockfiles (`bun.lock`,
`package-lock.json`), binary/media assets (`public/`, `.glb`, `.woff2`,
images, videos), generated files (marker or directory convention), vendored
code, `.drawio` (tool-owned XML), third-party license files.

## Organization (in-file only — no new files, no renames, no logic changes)

- Imports: keep grouped stdlib → third-party → local where the file already
  does so. **Never reorder side-effect imports or statements whose order is
  load-bearing** (Python module init, `import './x.css'`, SQL, CSS cascade).
- Long files (>~200 lines) get `// ── Name ──` / `# ── Name ──` banners
  dividing logical regions: helpers → pieces → main export; state →
  lifecycle → hooks → gates. Small files need no banners.
- Keep one blank line between top-level declarations. Collapse stray triple
  blanks.
- Do not rename symbols, extract components, move code across files, or
  touch formatting beyond blank-line hygiene. Preserve every existing
  comment's information (restyle the wording, keep the facts — ADR/doc/ISA
  references stay).

## Done means

`git diff` on the file shows only comments and whitespace/ordering of
declarations — zero behaviour change. Report files skipped and why.
