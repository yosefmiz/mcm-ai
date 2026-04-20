# Contract corpus

Drop reference contracts here. The folder is gitignored — these files stay
on your machine only and never leave the repo.

## Structure

```
data/contracts/
  <JURISDICTION>/<TYPE>/<LANGUAGE>/<file>
```

`JURISDICTION` is freeform (e.g. `IL`, `NY-US`, `DE-BE`).
`TYPE` is `ANNUAL`, `SUBLET`, or `MANAGEMENT`.
`LANGUAGE` is `HE`, `EN`, `RU`, or `AR`.

## Examples

```
data/contracts/IL/ANNUAL/HE/standard-tlv-apartment.docx
data/contracts/IL/ANNUAL/HE/north-tlv-furnished.pdf
data/contracts/IL/SUBLET/HE/short-term-airbnb-style.docx
data/contracts/NY-US/ANNUAL/EN/brooklyn-12-month.pdf
```

## Supported file types

- `.docx` — Microsoft Word
- `.pdf` — PDF
- `.txt` / `.md` — plain text

## Loading them into the DB

Run from the repo root:

```
npm run ingest:templates
```

The script walks this tree, extracts text, asks the AI to split each contract
into the standard section schema, and saves to `ContractTemplate`. Existing
templates with the same `(source, jurisdiction, type, language)` are skipped.

## Why ten or more

A single template makes the model parrot it. With 5+ templates per
(jurisdiction, type, language) combo the generator picks 3 random exemplars
per call — variety in the output rather than rigid duplication.
