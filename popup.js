const API_BASE = 'http://localhost:8080';
const GOOGLE_CLIENT_ID = '661661459372-vo69p37g9hodrhll0sr6skp7tgr92d4i.apps.googleusercontent.com';

let currentReviews = [];
let currentProductName = '';

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

async function apiRequest(endpoint, options = {}) {
  const { kp_token } = await chrome.storage.local.get('kp_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (kp_token) headers['Authorization'] = `Bearer ${kp_token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  return /amazon\.(com|co\.uk|ca|com\.au)/.test(url);
}

async function scrapeReviews(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'scrapeReviews' }, (response) => {
      resolve(response || { productName: '', reviews: [] });
    });
  });
}

function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
  document.getElementById('results').style.display = show ? 'none' : 'none';
  document.getElementById('analyze').disabled = show;
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
  renderList('pros', data.pros);
  renderList('cons', data.cons);
  renderCategories(data.categoryHighlights);
  renderFakeReviews(data.fakeReviewFlags);
  document.getElementById('results').style.display = 'block';
}

async function analyzeReviews() {
  showLoading(true);

  try {
    const tab = await getCurrentTab();
    const { productName, reviews } = await scrapeReviews(tab.id);

    if (reviews.length === 0) {
      showLoading(false);
      showToast('No reviews found. Make sure you are on a product page with reviews visible.', 'error');
      return;
    }

    currentReviews = reviews;
    currentProductName = productName;
    document.getElementById('product-name').textContent = productName;

    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews, productName }),
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

    if (data.remainingAnalyses !== undefined) {
      updateRemainingBadge(data.remainingAnalyses);
    }
  } catch (err) {
    showLoading(false);
    showToast('Error analyzing reviews: ' + err.message, 'error');
  }
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
    chatSection.style.display = 'none';
  } else if (!user.isPremium) {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'block';
    userEmail.textContent = user.email;
    premiumNotLoggedIn.style.display = 'none';
    premiumFree.style.display = 'block';
    premiumActive.style.display = 'none';
    chatSection.style.display = 'none';
  } else {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'block';
    userEmail.textContent = user.email;
    premiumNotLoggedIn.style.display = 'none';
    premiumFree.style.display = 'none';
    premiumActive.style.display = 'block';
    chatSection.style.display = 'block';
  }
}

async function login() {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', 'email profile');

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });

    const hash = new URL(responseUrl).hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');

    if (!accessToken) throw new Error('No access token received');

    const response = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleToken: accessToken }),
    });

    if (!response.ok) throw new Error('Authentication failed');

    const { token, user } = await response.json();
    await chrome.storage.local.set({ kp_token: token, kp_user: user });
    updateAuthUI(user);
  } catch (err) {
    console.error('Login failed:', err);
  }
}

async function logout() {
  await chrome.storage.local.remove(['kp_token', 'kp_user']);
  updateAuthUI(null);
}

// Chat

function addChatMessage(text, role) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  addChatMessage(question, 'user');

  try {
    const response = await apiRequest('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        reviews: currentReviews,
        productName: currentProductName,
        question,
      }),
    });

    if (!response.ok) throw new Error('Chat request failed');

    const data = await response.json();
    addChatMessage(data.answer, 'assistant');
  } catch (err) {
    addChatMessage('Error: ' + err.message, 'assistant');
  }
}

// Init

document.addEventListener('DOMContentLoaded', async () => {
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

  // Analyze
  document.getElementById('analyze').addEventListener('click', analyzeReviews);

  // Premium actions
  document.getElementById('upgrade').addEventListener('click', async () => {
    try {
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
  });

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

  // Chat
  document.getElementById('chat-send').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
});
