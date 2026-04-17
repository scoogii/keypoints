let currentReviews = [];
let currentProductName = '';
let currentProductDetails = {};
let currentASIN = '';
let currentPrice = '';
let currentImage = '';
let lastAnalysis = null;

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
    const user = await getStoredUser();
    if (!user) {
      showToast('Sign in with Google to start your subscription.', 'info');
      return;
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
  document.getElementById('results').style.display = show ? 'none' : 'none';
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
    priceHistory.style.display = 'block';

    getCurrentTab().then(tab => {
      const url = tab.url || '';
      let camelRegion = 'us';
      let camelBase = 'https://camelcamelcamel.com';
      if (/amazon\.com\.au/.test(url)) { camelRegion = 'au'; camelBase = 'https://au.camelcamelcamel.com'; }
      else if (/amazon\.co\.uk/.test(url)) { camelRegion = 'uk'; camelBase = 'https://uk.camelcamelcamel.com'; }
      else if (/amazon\.ca/.test(url)) { camelRegion = 'ca'; camelBase = 'https://ca.camelcamelcamel.com'; }
      else if (/amazon\.de/.test(url)) { camelRegion = 'de'; camelBase = 'https://de.camelcamelcamel.com'; }
      else if (/amazon\.fr/.test(url)) { camelRegion = 'fr'; camelBase = 'https://fr.camelcamelcamel.com'; }
      else if (/amazon\.es/.test(url)) { camelRegion = 'es'; camelBase = 'https://es.camelcamelcamel.com'; }
      else if (/amazon\.it/.test(url)) { camelRegion = 'it'; camelBase = 'https://it.camelcamelcamel.com'; }
      else if (/amazon\.co\.jp/.test(url)) { camelRegion = 'jp'; camelBase = 'https://jp.camelcamelcamel.com'; }

      const chartUrl = `https://charts.camelcamelcamel.com/${camelRegion}/${currentASIN}/amazon.png?force=1&zero=0&w=500&h=200&desired=false&legend=1&ilt=1&tp=all&fo=0&lang=en`;
      document.getElementById('price-chart').src = chartUrl;
      document.getElementById('camel-link').href = `${camelBase}/product/${currentASIN}`;
    });
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
  } catch (err) {
    console.error('Login failed:', err);
    showToast('Google sign-in failed. Please try again.', 'error');
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
