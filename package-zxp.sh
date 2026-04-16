#!/bin/bash
# package-zxp.sh — Signs and packages ae-panel/ into a distributable FAE.zxp
# Requirements: ZXPSignCmd must be on PATH
#   Download: https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD
#
# Usage:
#   chmod +x package-zxp.sh
#   ./package-zxp.sh

set -e

CERT="FAE_cert.p12"
CERT_PASS="faebridge2024"
OUT="dist/FAE.zxp"
PANEL_DIR="ae-panel"

# ── Check ZXPSignCmd ─────────────────────────────────────────────────────────
if ! command -v ZXPSignCmd &> /dev/null; then
  echo "ERROR: ZXPSignCmd not found on PATH."
  echo "Download from: https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD"
  echo "Add it to your PATH and retry."
  exit 1
fi

mkdir -p dist

# ── Create self-signed cert if it doesn't exist ───────────────────────────────
if [ ! -f "$CERT" ]; then
  echo "Creating self-signed certificate..."
  ZXPSignCmd -selfSignedCert US CA "FAE" "FAE Dev" "$CERT_PASS" "$CERT"
  echo "Certificate created: $CERT"
else
  echo "Using existing certificate: $CERT"
fi

# ── Package ───────────────────────────────────────────────────────────────────
echo ""
echo "Packaging ZXP..."
ZXPSignCmd -sign "$PANEL_DIR" "$OUT" "$CERT" "$CERT_PASS" \
  -tsa http://timestamp.digicert.com

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "Verifying..."
ZXPSignCmd -verify "$OUT" -certInfo

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Built: $OUT"
echo ""
echo "  Install instructions:"
echo "  1. Download ZXP/UXP Installer from aescripts.com (free)"
echo "  2. Drag FAE.zxp into the installer window"
echo "  3. Restart After Effects"
echo "  4. Open via: Window → Extensions → FAE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
