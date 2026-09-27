# Third-Party Notices

Moonlit uses the following open-source software — thank you to their authors.

## taibu-core (fortune-chart algorithms)

- Project: https://github.com/hhszzzz/taibu
- npm: `taibu-core` (only the MIT-licensed `taibu-core` package is used)
- License: MIT License — Copyright (c) 2026 hhszzzz
- Used for: BaZi / ZiWei / Western astrology chart calculations
  (`backend/divination.js`)
- The MIT license permits commercial use, modification, and closed-source
  distribution; this file serves as the copyright attribution.

## ZiWei DouShu open sample dataset (optional RAG enhancement)

- Project: https://github.com/Renhuai123/ziwei-doushu
- License: the author permits free commercial use; the only requirement is
  keeping the data-source attribution.
- Used for: `backend/ziwei-rag.js` can optionally read local samples to
  provide similar-chart references for ZiWei readings.
- The dataset itself is not distributed with this code; download it yourself
  (see `tools/fetch-ziwei-samples.sh`).

## Notes

- The 78 tarot card illustrations were custom-made for Moonlit;
  all rights reserved.
- Secrets in `.env` (Doubao / ADMIN_TOKEN / XorPay) never enter the git repo.
