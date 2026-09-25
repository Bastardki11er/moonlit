#!/bin/bash
# ============================================================
# Moonlit — download the open ziwei sample dataset (optional)
# ------------------------------------------------------------
# Dataset: Renhuai123/ziwei-doushu "紫微斗数开源样本数据集 v3.0"
# 518,400 charts with interpretations, ~5.5 GB in 3 parts.
# Free for commercial use — the ONLY requirement is attribution
# (see THIRD-PARTY-NOTICES.md). Run this on your server (or any
# machine with disk space), then restart the site; the RAG adapter
# in backend/ziwei-rag.js picks the data up automatically.
#
# NOTE: verify the exact file URLs on the releases page first —
# https://github.com/Renhuai123/ziwei-doushu/releases/tag/v3.0-samples
# ============================================================
set -e
BASE="https://github.com/Renhuai123/ziwei-doushu/releases/download/v3.0-samples"
DEST="$(dirname "$0")/../backend/data/ziwei-samples"
mkdir -p "$DEST"
cd "$DEST"

for n in 1 2 3; do
  f="ziwei-samples-v3-part$n.zip.00$n"
  echo "== downloading $f ..."
  curl -L -o "$f" "$BASE/$f" || echo "!! failed: $f — check the releases page for the exact filename"
done

echo "== merging & unzipping ..."
cat ziwei-samples-v3-part*.zip.* > combined.zip 2>/dev/null || true
unzip -o combined.zip
rm -f combined.zip ziwei-samples-v3-part*.zip.*

echo "done. Files in $DEST:"
ls | head -5
echo "Restart moonlit (pm2 restart moonlit) to let the RAG adapter index them."
