let currentReviews = [];
let currentProductName = '';
let currentProductDetails = {};
let currentASIN = '';
let currentPrice = '';
let currentImage = '';
let lastAnalysis = null;
let priceHistoryRenderId = 0;

function isPremiumUser(user) {
  return Boolean(user && user.isPremium);
}

async function getStoredUser() {
  const { kp_user } = await chrome.storage.local.get('kp_user');
  return kp_user || null;
}

function setPremiumLockState(isPremium) {
  document.querySelectorAll('.premium-feature-card').forEach(card => {
    card.classList.toggle('is-locked', !isPremium);
  });
}

function updatePremiumCallToActions(user) {
  const ctaLabel = user ? 'Upgrade to Premium' : 'Sign In to Unlock';
  document.querySelectorAll('[data-premium-cta]').forEach(button => {
    button.textContent = ctaLabel;
  });
}

function getPremiumUpsellMessage(user, featureName) {
  if (!user) {
    return `Sign in to unlock ${featureName} with Premium.`;
  }
  return `${featureName} is a Premium feature. Upgrade to unlock it.`;
}

async function handlePremiumGate(featureName) {
  const user = await getStoredUser();
  showToast(getPremiumUpsellMessage(user, featureName), 'info');
}

async function startUpgradeFlow() {
  try {
    let user = await getStoredUser();
    if (!user) {
      user = await login();
      if (!user) {
        return;
      }
    }

    const tab = await getCurrentTab();
    const response = await apiRequest('/api/stripe/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ returnUrl: tab.url }),
    });
    if (!response.ok) throw new Error('Failed to create checkout session');
    const { url } = await response.json();
    chrome.tabs.create({ url });
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  void toast.offsetWidth;
  toast.classList.add('visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function updateRemainingBadge(remaining) {
  const badge = document.getElementById('remaining-badge');
  if (remaining === -1) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';
  badge.textContent = `${remaining} ${remaining === 1 ? 'analysis' : 'analyses'} remaining today`;
  badge.classList.toggle('warning', remaining === 0);
}

async function getInstallId() {
  const { kp_install_id } = await chrome.storage.local.get('kp_install_id');
  if (kp_install_id) return kp_install_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ kp_install_id: id });
  return id;
}

async function apiRequest(endpoint, options = {}) {
  const { kp_token } = await chrome.storage.local.get('kp_token');
  const installId = await getInstallId();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (kp_token) headers['Authorization'] = `Bearer ${kp_token}`;
  headers['X-Install-ID'] = installId;

  const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  return response;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isAmazonPage(url) {
  return /amazon\.(com|co\.uk|ca|com\.au|de|fr|es|it|co\.jp|in|com\.br|nl|sg|com\.mx|se|pl|ae|sa|com\.tr)/.test(url);
}

async function scrapeReviews(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'scrapeReviews' }, (response) => {
      resolve(response || { productName: '', reviews: [], asin: '', price: '', image: '' });
    });
  });
}

async function scrapeProductPage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'scrapeProductPage' }, (response) => {
      resolve(response || { productName: '', reviews: [], productDetails: {} });
    });
  });
}

function getCamelCamelCamelConfig(url, asin) {
  let region = 'us';
  let baseUrl = 'https://camelcamelcamel.com';
  let marketLabel = 'Amazon US';

  if (/amazon\.com\.au/.test(url)) {
    region = 'au';
    baseUrl = 'https://au.camelcamelcamel.com';
    marketLabel = 'Amazon AU';
  } else if (/amazon\.co\.uk/.test(url)) {
    region = 'uk';
    baseUrl = 'https://uk.camelcamelcamel.com';
    marketLabel = 'Amazon UK';
  } else if (/amazon\.ca/.test(url)) {
    region = 'ca';
    baseUrl = 'https://ca.camelcamelcamel.com';
    marketLabel = 'Amazon CA';
  } else if (/amazon\.de/.test(url)) {
    region = 'de';
    baseUrl = 'https://de.camelcamelcamel.com';
    marketLabel = 'Amazon DE';
  } else if (/amazon\.fr/.test(url)) {
    region = 'fr';
    baseUrl = 'https://fr.camelcamelcamel.com';
    marketLabel = 'Amazon FR';
  } else if (/amazon\.es/.test(url)) {
    region = 'es';
    baseUrl = 'https://es.camelcamelcamel.com';
    marketLabel = 'Amazon ES';
  } else if (/amazon\.it/.test(url)) {
    region = 'it';
    baseUrl = 'https://it.camelcamelcamel.com';
    marketLabel = 'Amazon IT';
  } else if (/amazon\.co\.jp/.test(url)) {
    region = 'jp';
    baseUrl = 'https://jp.camelcamelcamel.com';
    marketLabel = 'Amazon JP';
  }

  return {
    region,
    baseUrl,
    marketLabel,
    chartUrl: `https://charts.camelcamelcamel.com/${region}/${asin}/amazon.png?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0&lang=en`,
    camelUrl: `${baseUrl}/product/${asin}`,
  };
}

function setPriceHistoryText(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function formatDisplayPrice(price) {
  return price ? `Now ${price}` : 'Current price unavailable';
}

function getPriceChartPalette() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    return {
      panelTop: 'rgba(255, 174, 66, 0.12)',
      panelBottom: 'rgba(255, 255, 255, 0.94)',
      grid: 'rgba(0, 0, 0, 0.08)',
      text: 'rgba(29, 29, 31, 0.72)',
      subtext: 'rgba(29, 29, 31, 0.5)',
      line: '#d97706',
      pointOuter: '#fff7ed',
      pointInner: '#d97706',
      areaTop: 'rgba(217, 119, 6, 0.22)',
      areaBottom: 'rgba(217, 119, 6, 0.02)',
    };
  }

  return {
    panelTop: 'rgba(255, 174, 66, 0.14)',
    panelBottom: 'rgba(255, 255, 255, 0.02)',
    grid: 'rgba(255, 255, 255, 0.08)',
    text: 'rgba(255, 255, 255, 0.72)',
    subtext: 'rgba(255, 255, 255, 0.5)',
    line: '#ffad42',
    pointOuter: '#fff2d6',
    pointInner: '#ffad42',
    areaTop: 'rgba(255, 174, 66, 0.26)',
    areaBottom: 'rgba(255, 174, 66, 0.02)',
  };
}

function updatePriceHistorySummary(message, trend = 'Waiting for chart data...') {
  setPriceHistoryText('price-history-status', message);
  setPriceHistoryText('price-history-trend', trend);
  setPriceHistoryText('price-history-current', formatDisplayPrice(currentPrice));
}

function resetPriceHistoryCanvas(message) {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;

  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const palette = getPriceChartPalette();

  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.panelTop);
  gradient.addColorStop(1, palette.panelBottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let row = 1; row <= 4; row += 1) {
    const y = Math.round((height / 5) * row) + 0.5;
    context.beginPath();
    context.moveTo(16, y);
    context.lineTo(width - 16, y);
    context.stroke();
  }

  context.fillStyle = palette.text;
  context.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  context.textAlign = 'center';
  context.fillText(message, width / 2, height / 2);
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to decode chart image'));
    };
    image.src = objectUrl;
  });
}

async function fetchCamelChartImage(chartUrl) {
  const response = await fetch(chartUrl, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Chart request failed (${response.status})`);
  }
  const blob = await response.blob();
  return loadImageFromBlob(blob);
}

function isCamelAmazonLinePixel(r, g, b, a) {
  if (a < 180) return false;
  return r >= 175 && g >= 85 && g <= 210 && b <= 120 && (r - b) >= 90 && (r - g) >= 10;
}

function interpolateMissingSeries(series, maxGap = 18) {
  const output = [...series];
  let previousIndex = -1;

  for (let index = 0; index < output.length; index += 1) {
    if (output[index] == null) continue;

    if (previousIndex >= 0) {
      const gap = index - previousIndex;
      if (gap > 1 && gap <= maxGap) {
        const start = output[previousIndex];
        const end = output[index];
        for (let offset = 1; offset < gap; offset += 1) {
          const progress = offset / gap;
          output[previousIndex + offset] = start + ((end - start) * progress);
        }
      }
    }

    previousIndex = index;
  }

  return output;
}

function resampleSeries(series, count = 36) {
  if (!series.length) return [];

  const points = [];
  const maxIndex = series.length - 1;
  for (let step = 0; step < count; step += 1) {
    const position = (maxIndex * step) / Math.max(count - 1, 1);
    const left = Math.floor(position);
    const right = Math.min(maxIndex, Math.ceil(position));
    const blend = position - left;
    const leftValue = series[left];
    const rightValue = series[right];
    points.push(leftValue + ((rightValue - leftValue) * blend));
  }

  return points;
}

function extractSeriesFromCamelChart(image) {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth || image.width;
  sourceCanvas.height = image.naturalHeight || image.height;

  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const { data, width, height } = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const topBound = 12;
  const bottomBound = height - 38;
  const leftBound = 28;
  const rightBound = width - 8;
  const rawSeries = new Array(rightBound - leftBound).fill(null);

  for (let x = leftBound; x < rightBound; x += 1) {
    const matches = [];
    for (let y = topBound; y < bottomBound; y += 1) {
      const index = ((y * width) + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (isCamelAmazonLinePixel(r, g, b, a)) {
        matches.push(y);
      }
    }

    if (matches.length) {
      rawSeries[x - leftBound] = matches[Math.floor(matches.length / 2)];
    }
  }

  const filledSeries = interpolateMissingSeries(rawSeries).filter(value => value != null);
  if (filledSeries.length < 24) {
    throw new Error('Not enough chart data points');
  }

  const minY = Math.min(...filledSeries);
  const maxY = Math.max(...filledSeries);
  const range = Math.max(maxY - minY, 6);
  const normalizedSeries = resampleSeries(filledSeries, 40).map(value => 1 - ((value - minY) / range));

  return {
    values: normalizedSeries,
    firstValue: normalizedSeries[0],
    lastValue: normalizedSeries[normalizedSeries.length - 1],
    coverage: filledSeries.length / rawSeries.length,
  };
}

function getTrendCopy(series) {
  const delta = (series.lastValue - series.firstValue) * 100;
  if (delta >= 8) return 'Price trend has climbed versus the left side of the chart.';
  if (delta <= -8) return 'Price trend has cooled versus the left side of the chart.';
  return 'Price trend looks relatively steady across the captured chart.';
}

function drawPriceHistoryGraph(series) {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;

  const cssWidth = canvas.clientWidth || 392;
  const cssHeight = 220;
  const dpr = window.devicePixelRatio || 1;
  const palette = getPriceChartPalette();
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const context = canvas.getContext('2d');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 18, right: 16, bottom: 22, left: 16 };
  const plotWidth = cssWidth - padding.left - padding.right;
  const plotHeight = cssHeight - padding.top - padding.bottom;

  const backgroundGradient = context.createLinearGradient(0, 0, 0, cssHeight);
  backgroundGradient.addColorStop(0, palette.panelTop);
  backgroundGradient.addColorStop(1, palette.panelBottom);
  context.fillStyle = backgroundGradient;
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let row = 0; row <= 4; row += 1) {
    const y = padding.top + ((plotHeight / 4) * row);
    context.beginPath();
    context.moveTo(padding.left, Math.round(y) + 0.5);
    context.lineTo(cssWidth - padding.right, Math.round(y) + 0.5);
    context.stroke();
  }

  const points = series.values.map((value, index) => ({
    x: padding.left + ((plotWidth * index) / Math.max(series.values.length - 1, 1)),
    y: padding.top + ((1 - value) * plotHeight),
  }));

  const areaPath = new Path2D();
  points.forEach((point, index) => {
    if (index === 0) {
      areaPath.moveTo(point.x, point.y);
    } else {
      areaPath.lineTo(point.x, point.y);
    }
  });
  areaPath.lineTo(points[points.length - 1].x, cssHeight - padding.bottom);
  areaPath.lineTo(points[0].x, cssHeight - padding.bottom);
  areaPath.closePath();

  const areaGradient = context.createLinearGradient(0, padding.top, 0, cssHeight - padding.bottom);
  areaGradient.addColorStop(0, palette.areaTop);
  areaGradient.addColorStop(1, palette.areaBottom);
  context.fillStyle = areaGradient;
  context.fill(areaPath);

  context.strokeStyle = palette.line;
  context.lineWidth = 2.5;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.stroke();

  const lastPoint = points[points.length - 1];
  context.fillStyle = palette.pointOuter;
  context.beginPath();
  context.arc(lastPoint.x, lastPoint.y, 4.5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.pointInner;
  context.beginPath();
  context.arc(lastPoint.x, lastPoint.y, 2.5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.subtext;
  context.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
  context.textAlign = 'left';
  context.fillText('Earlier', padding.left, cssHeight - 7);
  context.textAlign = 'right';
  context.fillText('Now', cssWidth - padding.right, cssHeight - 7);
}

function drawCamelChartFallback(image) {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;

  const cssWidth = canvas.clientWidth || 392;
  const cssHeight = 220;
  const dpr = window.devicePixelRatio || 1;
  const palette = getPriceChartPalette();
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const context = canvas.getContext('2d');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const backgroundGradient = context.createLinearGradient(0, 0, 0, cssHeight);
  backgroundGradient.addColorStop(0, palette.panelTop);
  backgroundGradient.addColorStop(1, palette.panelBottom);
  context.fillStyle = backgroundGradient;
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.globalAlpha = 0.94;
  context.drawImage(image, 0, 0, cssWidth, cssHeight);
  context.globalAlpha = 1;
}

async function renderPriceHistory() {
  const priceHistory = document.getElementById('price-history');
  if (!priceHistory) return;

  if (!currentASIN) {
    priceHistory.style.display = 'none';
    return;
  }

  priceHistory.style.display = 'block';
  updatePriceHistorySummary('Loading price history from CamelCamelCamel...');
  resetPriceHistoryCanvas('Loading chart...');

  const renderId = ++priceHistoryRenderId;
  const tab = await getCurrentTab();
  const config = getCamelCamelCamelConfig(tab.url || '', currentASIN);
  document.getElementById('camel-link').href = config.camelUrl;
  setPriceHistoryText('price-history-market', config.marketLabel);
  setPriceHistoryText('price-history-current', formatDisplayPrice(currentPrice));

  try {
    const chartImage = await fetchCamelChartImage(config.chartUrl);
    if (renderId !== priceHistoryRenderId) return;

    try {
      const series = extractSeriesFromCamelChart(chartImage);
      drawPriceHistoryGraph(series);
      updatePriceHistorySummary(
        `Built from CamelCamelCamel's Amazon line for ${config.marketLabel}.`,
        getTrendCopy(series),
      );
    } catch (error) {
      drawCamelChartFallback(chartImage);
      updatePriceHistorySummary(
        `Showing CamelCamelCamel reference history for ${config.marketLabel}.`,
        'Open the full CamelCamelCamel page for the complete interactive history.',
      );
    }
  } catch (error) {
    if (renderId !== priceHistoryRenderId) return;
    resetPriceHistoryCanvas('Chart unavailable');
    updatePriceHistorySummary(
      'We could not render this price history right now.',
      'Open the full CamelCamelCamel page for the complete interactive history.',
    );
  }
}

const loadingMessages = [
  'Sifting through the reviews...',
  'Panning for golden insights...',
  'Separating the real from the fake...',
  'Reading so you don\'t have to...',
  'Crunching the numbers...',
  'Digging through the feedback...',
  'Finding the nuggets of truth...',
  'Analyzing what shoppers really think...',
  'Doing the homework for you...',
  'Almost there, just a few more reviews...',
  'Hunting for patterns...',
  'Weighing the pros and cons...',
  'Decoding star ratings...',
  'Spotting the suspicious ones...',
  'Mining the review goldmine...',
  'Checking for red flags...',
  'Summarizing hundreds of opinions...',
  'Your personal review assistant at work...',
  'Turning reviews into insights...',
  'Making sense of the chaos...',
];

let loadingInterval = null;

function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
  document.getElementById('results').style.display = show ? 'none' : 'block';
  document.getElementById('analyze').disabled = show;
  if (show) {
    const el = document.getElementById('loading-text');
    let lastIndex = -1;
    const pickMessage = () => {
      let index;
      do { index = Math.floor(Math.random() * loadingMessages.length); } while (index === lastIndex);
      lastIndex = index;
      el.textContent = loadingMessages[index];
    };
    pickMessage();
    loadingInterval = setInterval(pickMessage, 3000);
  } else if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
}

function renderSentiment(score, label) {
  const el = document.getElementById('sentiment');
  const color = score >= 70 ? '#50bf68' : score >= 40 ? '#f0ad4e' : '#d9534f';
  el.innerHTML = `
    <div class="sentiment-bar">
      <div class="sentiment-fill" style="width:${score}%; background:${color}"></div>
    </div>
    <span class="sentiment-label">${label} (${score}%)</span>
  `;
}

function renderList(containerId, items) {
  const ul = document.getElementById(containerId);
  ul.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.point;
    ul.appendChild(li);
  });
}

function renderCategories(highlights) {
  const container = document.getElementById('categories');
  container.innerHTML = '';
  highlights.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `<strong>${cat.category}</strong>`;
    const ul = document.createElement('ul');
    cat.points.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    });
    div.appendChild(ul);
    container.appendChild(div);
  });
}

function renderFakeReviews(flags) {
  const container = document.getElementById('fake-reviews');
  container.innerHTML = '';
  if (flags.length === 0) {
    container.innerHTML = '<p class="no-flags">No suspicious reviews detected ✅</p>';
    return;
  }
  flags.forEach(flag => {
    const div = document.createElement('div');
    div.className = 'fake-flag';
    div.innerHTML = `
      <p class="flag-title">"${flag.reviewTitle}"</p>
      <p class="flag-reason">${flag.reason}</p>
      <span class="flag-confidence">Confidence: ${Math.round(flag.confidence * 100)}%</span>
    `;
    container.appendChild(div);
  });
}

function renderResults(data) {
  renderSentiment(data.sentimentScore, data.sentimentLabel);
  document.getElementById('summary').textContent = data.summary || '';
  renderList('pros', data.pros);
  renderList('cons', data.cons);
  renderCategories(data.categoryHighlights);
  renderFakeReviews(data.fakeReviewFlags);
  document.getElementById('results').style.display = 'block';
  document.getElementById('analyze').style.display = 'none';
  document.getElementById('reanalyze').style.display = 'block';
}

function getCacheKey(url) {
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  return match ? 'kp_cache_' + match[1] : 'kp_cache_' + btoa(url).slice(0, 30);
}

async function saveTabCache(url, data) {
  const key = getCacheKey(url);
  await chrome.storage.local.set({ [key]: {
    ...data,
    cachedAt: Date.now(),
  }});
}

async function loadTabCache(url) {
  const key = getCacheKey(url);
  const result = await chrome.storage.local.get(key);
  const cached = result[key];
  if (!cached) return null;
  // Expire after 1 hour
  if (Date.now() - cached.cachedAt > 3600000) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return cached;
}

async function analyzeReviews() {
  showLoading(true);
  try {
    const tab = await getCurrentTab();
    const { productName, reviews, asin, price, image } = await scrapeReviews(tab.id);
    currentASIN = asin || '';
    currentPrice = price || '';
    currentImage = image || '';

    if (reviews.length === 0) {
      showLoading(false);
      showToast('No reviews found. Try refreshing the page and scroll down to load reviews.', 'error');
      return;
    }
    currentReviews = reviews;
    currentProductName = productName;
    document.getElementById('product-name').textContent = productName;

    const domain = new URL(tab.url).origin;
    // Get all cookies (including HttpOnly) that the browser sends to Amazon
    const allCookies = await chrome.cookies.getAll({ url: tab.url });
    const cookieStr = allCookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await apiRequest('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ reviews, productName, asin: currentASIN, domain, cookies: cookieStr }),
    });

    if (response.status === 429) {
      showLoading(false);
      showToast('Daily analysis limit reached. Upgrade to Premium for unlimited analyses.', 'error');
      updateRemainingBadge(0);
      return;
    }

    if (!response.ok) throw new Error('Analysis failed');

    const data = await response.json();
    showLoading(false);
    renderResults(data);

    lastAnalysis = data;

    if (data.remainingAnalyses !== undefined) {
      updateRemainingBadge(data.remainingAnalyses);
    }

    const user = await getStoredUser();
    showPremiumFeatures(isPremiumUser(user));

    // Cache results for this product
    const tabForCache = await getCurrentTab();
    await saveTabCache(tabForCache.url, {
      productName: currentProductName,
      reviews: currentReviews,
      asin: currentASIN,
      price: currentPrice,
      image: currentImage,
      analysis: data,
    });
  } catch (err) {
    showLoading(false);
    showToast('Error analyzing reviews: ' + err.message, 'error');
  }
}

// Premium Features

function showPremiumFeatures(isPremium = false) {
  const premiumFeatures = document.getElementById('premium-features');
  premiumFeatures.style.display = 'block';
  setPremiumLockState(isPremium);

  const priceHistory = document.getElementById('price-history');
  if (currentASIN) {
    renderPriceHistory();
  } else {
    priceHistory.style.display = 'none';
  }
}

// Export

function generateReport() {
  if (!lastAnalysis) return '';

  const data = lastAnalysis;
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const highlights = (data.categoryHighlights || []).slice(0, 3);
  const bestFor = highlights.flatMap(cat => cat.points || []).slice(0, 3);
  const watchOuts = (data.cons || []).slice(0, 3);
  const topStrengths = (data.pros || []).slice(0, 4);
  const suspiciousCount = (data.fakeReviewFlags || []).length;

  let verdict = 'Worth a closer look';
  if (data.sentimentScore >= 80) verdict = 'Strong buy signal';
  else if (data.sentimentScore >= 65) verdict = 'Promising option';
  else if (data.sentimentScore >= 45) verdict = 'Mixed option';
  else verdict = 'High-risk pick';

  let report = `Sift Buying Brief - ${currentProductName}\nGenerated: ${date}\n========================\n\n`;
  report += `VERDICT: ${verdict}\n`;
  report += `SENTIMENT: ${data.sentimentLabel} (${data.sentimentScore}%)\n`;
  if (currentASIN) report += `ASIN: ${currentASIN}\n`;
  if (currentPrice) report += `PRICE: ${currentPrice}\n`;
  report += '\n';

  if (data.summary) {
    report += `SUMMARY\n${data.summary}\n\n`;
  }

  if (bestFor.length > 0) {
    report += 'BEST FOR\n';
    bestFor.forEach(point => { report += `• ${point}\n`; });
    report += '\n';
  }

  if (topStrengths.length > 0) {
    report += 'TOP STRENGTHS\n';
    topStrengths.forEach(item => { report += `• ${item.point}\n`; });
    report += '\n';
  }

  if (watchOuts.length > 0) {
    report += 'WATCH-OUTS\n';
    watchOuts.forEach(item => { report += `• ${item.point}\n`; });
    report += '\n';
  }

  if (highlights.length > 0) {
    report += 'KEY REVIEW THEMES\n';
    highlights.forEach(cat => {
      report += `• ${cat.category}: ${cat.points.join('; ')}\n`;
    });
    report += '\n';
  }

  report += 'RISK SNAPSHOT\n';
  if (suspiciousCount === 0) {
    report += '• No suspicious reviews were flagged in this analysis.\n';
  } else {
    report += `• ${suspiciousCount} suspicious review${suspiciousCount === 1 ? '' : 's'} flagged.\n`;
    data.fakeReviewFlags.slice(0, 3).forEach(flag => {
      report += `• "${flag.reviewTitle}" - ${flag.reason} (${Math.round(flag.confidence * 100)}% confidence)\n`;
    });
  }

  return report.trim();
}

async function copyToClipboard() {
  const text = generateReport();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Buying brief copied!', 'success');
  } catch {
    showToast('Failed to copy to clipboard', 'error');
  }
}

function downloadReport() {
  const text = generateReport();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sift-buying-brief-${currentProductName.slice(0, 50).replace(/[^a-z0-9]/gi, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Buying brief downloaded!', 'success');
}

// Theme

async function loadTheme() {
  const { kp_theme } = await chrome.storage.local.get('kp_theme');
  const theme = kp_theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').textContent = theme === 'dark' ? '🌙' : '☀️';
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('theme-toggle').textContent = next === 'dark' ? '🌙' : '☀️';
  await chrome.storage.local.set({ kp_theme: next });
  if (currentASIN) {
    renderPriceHistory();
  }
}

// Compare

let selectedCompareIndices = [];

async function updateCompareCount() {
  const { kp_comparisons } = await chrome.storage.local.get('kp_comparisons');
  const count = (kp_comparisons || []).length;
  const badge = document.getElementById('compare-count');
  if (badge) {
    badge.textContent = count;
  }
}

async function saveForComparison() {
  if (!lastAnalysis) return;

  const { kp_comparisons } = await chrome.storage.local.get('kp_comparisons');
  const comparisons = kp_comparisons || [];

  if (comparisons.length >= 5) {
    showToast('Maximum 5 comparisons saved. Remove one first.', 'error');
    return;
  }

  const exists = comparisons.some(c => c.asin === currentASIN && currentASIN);
  if (exists) {
    showToast('This product is already saved for comparison.', 'info');
    return;
  }

  comparisons.push({
    productName: currentProductName,
    asin: currentASIN,
    price: currentPrice,
    image: currentImage,
    sentimentScore: lastAnalysis.sentimentScore,
    sentimentLabel: lastAnalysis.sentimentLabel,
    pros: lastAnalysis.pros,
    cons: lastAnalysis.cons,
    savedAt: new Date().toISOString(),
  });

  await chrome.storage.local.set({ kp_comparisons: comparisons });
  updateCompareCount();
  showToast('Saved for comparison!', 'success');
}

async function showCompareView() {
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('compare-view').style.display = 'block';
  await renderCompareCards();
}

function hideCompareView() {
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('compare-view').style.display = 'none';
}

async function renderCompareCards() {
  const { kp_comparisons } = await chrome.storage.local.get('kp_comparisons');
  const comparisons = kp_comparisons || [];
  const container = document.getElementById('compare-cards');
  const empty = document.getElementById('compare-empty');

  container.innerHTML = '';
  selectedCompareIndices = [];
  document.getElementById('run-compare').style.display = 'none';
  document.getElementById('compare-result').style.display = 'none';

  if (comparisons.length === 0) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  comparisons.forEach((item, index) => {
    const color = item.sentimentScore >= 70 ? '#50bf68' : item.sentimentScore >= 40 ? '#f0ad4e' : '#d9534f';
    const prosHtml = (item.pros || []).slice(0, 3).map(p => `<li>${p.point}</li>`).join('');
    const consHtml = (item.cons || []).slice(0, 3).map(c => `<li>${c.point}</li>`).join('');

    const card = document.createElement('div');
    card.className = 'compare-card';
    card.dataset.index = index;
    card.innerHTML = `
      <div class="compare-card-header">
        ${item.image ? `<img class="compare-card-image" src="${item.image}" alt="" />` : ''}
        <div class="compare-card-info">
          <div class="compare-card-name">${item.productName}</div>
          ${item.price ? `<div class="compare-card-price">${item.price}</div>` : ''}
        </div>
      </div>
      <div class="compare-card-sentiment">
        <div class="sentiment-bar" style="height:4px;">
          <div class="sentiment-fill" style="width:${item.sentimentScore}%; background:${color}"></div>
        </div>
        <span class="sentiment-label" style="font-size:11px;">${item.sentimentLabel} (${item.sentimentScore}%)</span>
      </div>
      <div class="compare-card-lists">
        <div class="compare-card-list">
          <h3>Pros</h3>
          <ul>${prosHtml || '<li>—</li>'}</ul>
        </div>
        <div class="compare-card-list">
          <h3>Cons</h3>
          <ul>${consHtml || '<li>—</li>'}</ul>
        </div>
      </div>
      <button type="button" class="compare-card-remove" data-index="${index}">Remove</button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('compare-card-remove')) return;
      toggleCompareSelection(parseInt(card.dataset.index));
    });

    container.appendChild(card);
  });

  container.querySelectorAll('.compare-card-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeComparison(parseInt(e.target.dataset.index));
    });
  });
}

function toggleCompareSelection(index) {
  const pos = selectedCompareIndices.indexOf(index);
  if (pos !== -1) {
    selectedCompareIndices.splice(pos, 1);
  } else {
    if (selectedCompareIndices.length >= 2) return;
    selectedCompareIndices.push(index);
  }

  document.querySelectorAll('.compare-card').forEach(card => {
    const i = parseInt(card.dataset.index);
    const isSelected = selectedCompareIndices.includes(i);
    card.classList.toggle('compare-card-selected', isSelected);
    card.classList.toggle('compare-card-disabled', selectedCompareIndices.length >= 2 && !isSelected);
  });

  document.getElementById('run-compare').style.display =
    selectedCompareIndices.length === 2 ? 'block' : 'none';
}

async function runComparison() {
  const { kp_comparisons } = await chrome.storage.local.get('kp_comparisons');
  const comparisons = kp_comparisons || [];
  const a = comparisons[selectedCompareIndices[0]];
  const b = comparisons[selectedCompareIndices[1]];
  if (!a || !b) return;

  if (a.asin && b.asin && a.asin === b.asin) {
    showToast('You selected the same product twice. Pick two different products.', 'error');
    return;
  }

  const resultDiv = document.getElementById('compare-result');
  const colorA = a.sentimentScore >= 70 ? '#50bf68' : a.sentimentScore >= 40 ? '#f0ad4e' : '#d9534f';
  const colorB = b.sentimentScore >= 70 ? '#50bf68' : b.sentimentScore >= 40 ? '#f0ad4e' : '#d9534f';

  const prosA = (a.pros || []).map(p => `<li>✅ ${p.point}</li>`).join('');
  const consA = (a.cons || []).map(c => `<li>⚠️ ${c.point}</li>`).join('');
  const prosB = (b.pros || []).map(p => `<li>✅ ${p.point}</li>`).join('');
  const consB = (b.cons || []).map(c => `<li>⚠️ ${c.point}</li>`).join('');

  // Generate verdict
  let verdict = '';
  const diff = a.sentimentScore - b.sentimentScore;
  const winner = diff > 0 ? a : b;
  const loser = diff > 0 ? b : a;
  if (Math.abs(diff) <= 5) {
    verdict = `🤝 <strong>It's a toss-up!</strong> Both products have very similar sentiment scores. Choose based on which pros and cons matter most to you.`;
  } else {
    const winnerProsCount = (winner.pros || []).length;
    const loserConsCount = (loser.cons || []).length;
    verdict = `🏆 <strong>${winner.productName}</strong> comes out ahead with a ${winner.sentimentScore}% sentiment score vs ${loser.sentimentScore}%. It has ${winnerProsCount} highlighted pros compared to ${loserConsCount} flagged cons for the runner-up.`;
  }

  resultDiv.innerHTML = `
    <div class="compare-result-grid">
      <div class="compare-result-product">
        <h3>${a.productName}</h3>
        <div class="sentiment-bar" style="height:4px; margin-bottom:6px;">
          <div class="sentiment-fill" style="width:${a.sentimentScore}%; background:${colorA}"></div>
        </div>
        <span class="sentiment-label" style="font-size:11px;">${a.sentimentLabel} (${a.sentimentScore}%)</span>
        <ul class="compare-result-list">${prosA}</ul>
        <ul class="compare-result-list">${consA}</ul>
      </div>
      <div class="compare-result-product">
        <h3>${b.productName}</h3>
        <div class="sentiment-bar" style="height:4px; margin-bottom:6px;">
          <div class="sentiment-fill" style="width:${b.sentimentScore}%; background:${colorB}"></div>
        </div>
        <span class="sentiment-label" style="font-size:11px;">${b.sentimentLabel} (${b.sentimentScore}%)</span>
        <ul class="compare-result-list">${prosB}</ul>
        <ul class="compare-result-list">${consB}</ul>
      </div>
    </div>
    <div class="compare-verdict">
      <h3>Final Verdict</h3>
      <p>${verdict}</p>
    </div>
  `;
  resultDiv.style.display = 'block';
}

async function removeComparison(index) {
  const { kp_comparisons } = await chrome.storage.local.get('kp_comparisons');
  const comparisons = kp_comparisons || [];
  comparisons.splice(index, 1);
  await chrome.storage.local.set({ kp_comparisons: comparisons });
  updateCompareCount();
  renderCompareCards();
}

// Auth

function updateAuthUI(user) {
  const loggedOut = document.getElementById('logged-out');
  const loggedIn = document.getElementById('logged-in');
  const userEmail = document.getElementById('user-email');
  const premiumNotLoggedIn = document.getElementById('premium-not-logged-in');
  const premiumFree = document.getElementById('premium-free');
  const premiumActive = document.getElementById('premium-active');
  const chatSection = document.getElementById('chat-section');

  if (!user) {
    loggedOut.style.display = 'block';
    loggedIn.style.display = 'none';
    premiumNotLoggedIn.style.display = 'block';
    premiumFree.style.display = 'none';
    premiumActive.style.display = 'none';
    chatSection.style.display = 'block';
    setPremiumLockState(false);
    updatePremiumCallToActions(null);
  } else if (!user.isPremium) {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'block';
    userEmail.textContent = user.email;
    premiumNotLoggedIn.style.display = 'none';
    premiumFree.style.display = 'block';
    premiumActive.style.display = 'none';
    chatSection.style.display = 'block';
    setPremiumLockState(false);
    updatePremiumCallToActions(user);
  } else {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'block';
    userEmail.textContent = user.email;
    premiumNotLoggedIn.style.display = 'none';
    premiumFree.style.display = 'none';
    premiumActive.style.display = 'block';
    chatSection.style.display = 'block';
    setPremiumLockState(true);
    updatePremiumCallToActions(user);
  }
}

async function login() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    const accessToken = typeof authResult === 'string' ? authResult : authResult?.token;
    if (!accessToken) throw new Error('No access token received');

    const response = await fetch(`${CONFIG.API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleToken: accessToken }),
    });

    if (!response.ok) throw new Error('Authentication failed');

    const { token, user } = await response.json();
    await chrome.storage.local.set({ kp_token: token, kp_user: user, kp_google_token: accessToken });
    updateAuthUI(user);

    // Refresh remaining badge (hides for premium)
    try {
      const remainingRes = await apiRequest('/api/analyze/remaining');
      if (remainingRes.ok) {
        const { remaining } = await remainingRes.json();
        updateRemainingBadge(remaining);
      }
    } catch {}

    return user;
  } catch (err) {
    console.error('Login failed:', err);
    showToast('Google sign-in failed. Please try again.', 'error');
    return null;
  }
}

async function logout() {
  const { kp_google_token } = await chrome.storage.local.get('kp_google_token');
  if (kp_google_token) {
    try {
      await chrome.identity.removeCachedAuthToken({ token: kp_google_token });
    } catch (err) {
      console.warn('Failed to clear cached Google token:', err);
    }
  }

  await chrome.storage.local.remove(['kp_token', 'kp_user', 'kp_google_token']);
  updateAuthUI(null);

  // Refresh remaining badge (show for free tier)
  try {
    const remainingRes = await apiRequest('/api/analyze/remaining');
    if (remainingRes.ok) {
      const { remaining } = await remainingRes.json();
      updateRemainingBadge(remaining);
    }
  } catch {}
}

// Chat

function addChatMessage(text, role) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = normalizeChatText(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function normalizeChatText(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function addTypingIndicator() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message assistant typing-indicator';
  div.id = 'typing-indicator';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function persistChatMessages() {
  if (!currentASIN) return;
  const container = document.getElementById('chat-messages');
  const messages = [];
  container.querySelectorAll('.chat-message').forEach(el => {
    if (el.classList.contains('typing-indicator')) return;
    messages.push({
      text: el.textContent,
      role: el.classList.contains('user') ? 'user' : 'assistant',
    });
  });
  await chrome.storage.local.set({ ['kp_chat_' + currentASIN]: messages });
}

async function restoreChatMessages() {
  if (!currentASIN) return;
  const key = 'kp_chat_' + currentASIN;
  const result = await chrome.storage.local.get(key);
  const messages = result[key];
  if (!messages || !messages.length) return;
  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = `chat-message ${m.role}`;
    div.textContent = normalizeChatText(m.text);
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const user = await getStoredUser();
  if (!isPremiumUser(user)) {
    handlePremiumGate('AI chat');
    return;
  }

  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  addChatMessage(question, 'user');
  await persistChatMessages();
  addTypingIndicator();

  try {
    // Scrape full product page details for chat context
    if (!currentProductDetails || Object.keys(currentProductDetails).length === 0) {
      const tab = await getCurrentTab();
      const pageData = await scrapeProductPage(tab.id);
      currentProductDetails = pageData.productDetails || {};
      currentProductDetails.price = currentPrice;
    }

    const response = await apiRequest('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        reviews: currentReviews,
        productName: currentProductName,
        productDetails: currentProductDetails,
        question,
      }),
    });

    if (!response.ok) throw new Error('Chat request failed');

    const data = await response.json();
    removeTypingIndicator();
    addChatMessage(data.answer, 'assistant');
  } catch (err) {
    removeTypingIndicator();
    addChatMessage('Error: ' + err.message, 'assistant');
  }
  await persistChatMessages();
}

// Init

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme
  await loadTheme();

  // Check stored auth
  const { kp_token, kp_user } = await chrome.storage.local.get(['kp_token', 'kp_user']);

  if (kp_token) {
    try {
      const response = await apiRequest('/api/auth/me');
      if (response.ok) {
        const user = await response.json();
        await chrome.storage.local.set({ kp_user: user });
        updateAuthUI(user);
      } else {
        await chrome.storage.local.remove(['kp_token', 'kp_user']);
        updateAuthUI(null);
      }
    } catch {
      updateAuthUI(kp_user || null);
    }
  } else {
    updateAuthUI(null);
  }

  setPremiumLockState(!kp_user ? false : isPremiumUser(kp_user));

  // Fetch remaining analyses for free tier
  try {
    const remainingRes = await apiRequest('/api/analyze/remaining');
    if (remainingRes.ok) {
      const { remaining } = await remainingRes.json();
      updateRemainingBadge(remaining);
    }
  } catch {}

  // Update compare count badge
  updateCompareCount();

  // Auth event listeners
  document.getElementById('google-login').addEventListener('click', login);
  document.getElementById('logout').addEventListener('click', logout);

  // Tab check
  const tab = await getCurrentTab();

  if (!isAmazonPage(tab.url)) {
    document.getElementById('not-amazon').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    return;
  }

  // Restore cached results for this tab
  const cached = await loadTabCache(tab.url);
  if (cached) {
    currentProductName = cached.productName;
    currentReviews = cached.reviews;
    currentASIN = cached.asin || '';
    currentPrice = cached.price || '';
    currentImage = cached.image || '';
    lastAnalysis = cached.analysis;
    document.getElementById('product-name').textContent = currentProductName;
    renderResults(cached.analysis);

    const cachedUser = await getStoredUser();
    showPremiumFeatures(isPremiumUser(cachedUser));

    await restoreChatMessages();
  }

  // Analyze
  document.getElementById('analyze').addEventListener('click', analyzeReviews);

  // Premium actions
  document.getElementById('upgrade').addEventListener('click', startUpgradeFlow);

  document.getElementById('manage-subscription').addEventListener('click', async () => {
    try {
      const response = await apiRequest('/api/stripe/create-portal', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to open billing portal');
      const { url } = await response.json();
      chrome.tabs.create({ url });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Export
  document.getElementById('copy-clipboard').addEventListener('click', async () => {
    const user = await getStoredUser();
    if (!isPremiumUser(user)) {
      handlePremiumGate('Export');
      return;
    }
    copyToClipboard();
  });
  document.getElementById('download-report').addEventListener('click', async () => {
    const user = await getStoredUser();
    if (!isPremiumUser(user)) {
      handlePremiumGate('Export');
      return;
    }
    downloadReport();
  });

  // Re-analyze
  document.getElementById('reanalyze').addEventListener('click', () => {
    document.getElementById('reanalyze').style.display = 'none';
    document.getElementById('analyze').style.display = 'block';
    analyzeReviews();
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Compare
  document.getElementById('save-comparison').addEventListener('click', async () => {
    const user = await getStoredUser();
    if (!isPremiumUser(user)) {
      handlePremiumGate('Compare');
      return;
    }
    saveForComparison();
  });
  document.getElementById('compare-products').addEventListener('click', async () => {
    const user = await getStoredUser();
    if (!isPremiumUser(user)) {
      handlePremiumGate('Compare');
      return;
    }
    showCompareView();
  });
  document.getElementById('compare-back').addEventListener('click', hideCompareView);
  document.getElementById('run-compare').addEventListener('click', runComparison);

  // Chat
  document.getElementById('chat-send').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  document.querySelectorAll('[data-premium-cta]').forEach(button => {
    button.addEventListener('click', startUpgradeFlow);
  });

  document.querySelectorAll('[data-premium-lock]').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-premium-cta]')) return;
      startUpgradeFlow();
    });
  });
});
