#!/bin/bash
set -e

PROD_API_BASE="${PROD_API_BASE:-https://api.example.com}"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --api) PROD_API_BASE="$2"; shift 2;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo "Building production extension..."
echo "  API_BASE: $PROD_API_BASE"

rm -rf dist
mkdir -p dist

# Copy extension files
cp manifest.json popup.html popup.css popup.js content.js config.js icon16.png icon48.png icon128.png dist/

# Write production config
cat > dist/config.js << EOF
const CONFIG = {
  API_BASE: '${PROD_API_BASE}',
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
