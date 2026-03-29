#!/bin/bash
set -e

PROD_API_BASE="${PROD_API_BASE:-https://api.example.com}"
PROD_GOOGLE_CLIENT_ID="${PROD_GOOGLE_CLIENT_ID:-420667401546-nu9ousj8ri77tdd0cisd3fll92640qpq.apps.googleusercontent.com}"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --api) PROD_API_BASE="$2"; shift 2;;
    --client-id) PROD_GOOGLE_CLIENT_ID="$2"; shift 2;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo "Building production extension..."
echo "  API_BASE: $PROD_API_BASE"
echo "  GOOGLE_CLIENT_ID: $PROD_GOOGLE_CLIENT_ID"

rm -rf dist
mkdir -p dist

# Copy extension files
cp manifest.json popup.html popup.css popup.js content.js config.js icon16.png icon48.png icon128.png dist/

# Write production config
cat > dist/config.js << EOF
const CONFIG = {
  API_BASE: '${PROD_API_BASE}',
  GOOGLE_CLIENT_ID: '${PROD_GOOGLE_CLIENT_ID}',
};
EOF

# Create zip
cd dist
zip -r sift-extension.zip manifest.json popup.html popup.css popup.js content.js config.js icon16.png icon48.png icon128.png
cd ..

echo ""
echo "✅ Production build complete!"
echo "   Extension zip: dist/sift-extension.zip"
echo "   Unpacked dir:  dist/"
