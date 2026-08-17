# Vendored fonts

`JetBrainsMono-Regular.ttf` and `JetBrainsMono-Bold.ttf` are **Latin subsets** of
JetBrains Mono v2.304, used only by the PDF generators (`src/lib/pdfBrand.ts`).
JetBrains Mono is the brand's specified face for labels, badges and the tagline.

They are subsets for a concrete reason: **jsPDF embeds the entire font file into
every PDF it produces.** The full TTF is 277 KB per weight, which would have put
~550 KB into an invoice emailed to a client. The subset is 9.5 KB per weight,
and both weights together add roughly 11 KB to a finished PDF.

Regenerate with:

```sh
pip install fonttools
# from https://github.com/JetBrains/JetBrainsMono/releases (v2.304)
pyftsubset JetBrainsMono-Regular.ttf \
  --unicodes="U+0020-007E,U+00A0,U+00B7,U+2013,U+2014,U+2018-201D,U+2022,U+00D7" \
  --layout-features='' --no-hinting --desubroutinize --drop-tables+=DSIG \
  --output-file=JetBrainsMono-Regular.ttf
```

The subset deliberately covers only ASCII plus the punctuation these documents
actually use. It carries **no `₪` (U+20AA) and no Hebrew** — JetBrains Mono has
neither — so the ASCII currency fallback in `src/lib/format.ts` and the Hebrew
guard in `src/lib/summaryEmail.ts` remain necessary.

Licensed under the SIL Open Font License 1.1 — see `OFL.txt`, which ships
alongside the fonts as the licence requires.
