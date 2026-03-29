// Content script - runs on Amazon product pages
// Scrapes reviews from the current page

function scrapeProductName() {
  const el = document.querySelector('#productTitle');
  return el ? el.textContent.trim() : 'Unknown Product';
}

function scrapeASIN() {
  const match = window.location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (match) return match[1];
  const input = document.querySelector('input[name="ASIN"]');
  if (input) return input.value;
  return '';
}

function scrapePrice() {
  const el = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price-whole');
  return el ? el.textContent.trim() : '';
}

function scrapeImage() {
  const el = document.querySelector('#landingImage, #imgBlkFront');
  return el ? el.src : '';
}

function scrapeReviews() {
  const reviews = [];
  const reviewElements = document.querySelectorAll('[data-hook="review"]');
  
  reviewElements.forEach(el => {
    const titleEl = el.querySelector('[data-hook="review-title"]');
    const bodyEl = el.querySelector('[data-hook="review-body"]');
    const ratingEl = el.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]');
    const verifiedEl = el.querySelector('[data-hook="avp-badge"]');
    
    const title = titleEl ? titleEl.textContent.trim() : '';
    const body = bodyEl ? bodyEl.textContent.trim() : '';
    const ratingText = ratingEl ? ratingEl.textContent.trim() : '0';
    const rating = parseInt(ratingText.match(/(\d)/)?.[1] || '0');
    const verified = !!verifiedEl;
    
    if (body) {
      reviews.push({ title, rating, body, verified });
    }
  });
  
  return reviews;
}

function parseReviewsFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const reviews = [];

  doc.querySelectorAll('[data-hook="review"]').forEach(el => {
    const titleEl = el.querySelector('[data-hook="review-title"]');
    const bodyEl = el.querySelector('[data-hook="review-body"]');
    const ratingEl = el.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]');
    const verifiedEl = el.querySelector('[data-hook="avp-badge"]');

    const title = titleEl ? titleEl.textContent.trim() : '';
    const body = bodyEl ? bodyEl.textContent.trim() : '';
    const ratingText = ratingEl ? ratingEl.textContent.trim() : '0';
    const rating = parseInt(ratingText.match(/(\d)/)?.[1] || '0');
    const verified = !!verifiedEl;

    if (body) {
      reviews.push({ title, rating, body, verified });
    }
  });

  return reviews;
}

async function fetchReviewPage(url) {
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return [];
    const html = await resp.text();
    return parseReviewsFromHTML(html);
  } catch {
    return [];
  }
}

async function scrapeAllReviews(asin, maxReviews = 1000) {
  const seen = new Set();
  const allReviews = [];

  const addReview = (r) => {
    const key = r.title + '|' + r.body.substring(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      allReviews.push(r);
    }
  };

  // Start with on-page reviews
  scrapeReviews().forEach(addReview);

  const domain = window.location.origin;
  const baseUrl = `${domain}/product-reviews/${asin}/ref=cm_cr_arp_d_viewopt_srt?sortBy=recent&pageNumber=`;
  const BATCH_SIZE = 5;
  let page = 1;
  let done = false;

  while (allReviews.length < maxReviews && !done) {
    // Fetch a batch of pages in parallel
    const urls = [];
    for (let i = 0; i < BATCH_SIZE && page + i <= 200; i++) {
      urls.push(baseUrl + (page + i));
    }

    const batchResults = await Promise.all(urls.map(fetchReviewPage));

    let batchEmpty = true;
    for (const pageReviews of batchResults) {
      if (pageReviews.length > 0) batchEmpty = false;
      for (const r of pageReviews) {
        if (allReviews.length >= maxReviews) { done = true; break; }
        addReview(r);
      }
      if (done) break;
    }

    // If an entire batch returned no reviews, we've run out
    if (batchEmpty) break;

    page += BATCH_SIZE;

    // Brief pause between batches to avoid rate limiting
    if (!done && allReviews.length < maxReviews) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return allReviews;
}

function scrapeProductDetails() {
  const details = {};

  // About this item / feature bullets
  const bullets = [];
  document.querySelectorAll('#feature-bullets li, #featurebullets_feature_div li').forEach(el => {
    const text = el.textContent.trim();
    if (text) bullets.push(text);
  });
  if (bullets.length) details.features = bullets;

  // Product description
  const descEl = document.querySelector('#productDescription, #productDescription_feature_div');
  if (descEl) details.description = descEl.textContent.trim();

  // Product details table
  const detailRows = {};
  document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li, .prodDetTable tr').forEach(el => {
    const label = el.querySelector('th, .prodDetSectionEntry, span.a-text-bold');
    const value = el.querySelector('td, .prodDetAttrValue, span:not(.a-text-bold)');
    if (label && value) {
      const k = label.textContent.trim().replace(/[\s\u200F:]+$/g, '');
      const v = value.textContent.trim();
      if (k && v) detailRows[k] = v;
    }
  });
  if (Object.keys(detailRows).length) details.specifications = detailRows;

  // "From the manufacturer" or A+ content
  const aplusEl = document.querySelector('#aplus, #aplus_feature_div');
  if (aplusEl) {
    const aplusText = aplusEl.textContent.trim().substring(0, 2000);
    if (aplusText) details.manufacturerInfo = aplusText;
  }

  // Overall rating
  const ratingEl = document.querySelector('#acrPopover, [data-hook="rating-out-of-text"]');
  if (ratingEl) details.overallRating = ratingEl.textContent.trim();

  // Total reviews count
  const countEl = document.querySelector('#acrCustomerReviewText');
  if (countEl) details.totalReviews = countEl.textContent.trim();

  return details;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeReviews') {
    const asin = scrapeASIN();
    const productName = scrapeProductName();
    const price = scrapePrice();
    const image = scrapeImage();

    scrapeAllReviews(asin, 1000).then(reviews => {
      sendResponse({ productName, reviews, asin, price, image });
    });
    return true;
  }
  if (request.action === 'scrapeProductPage') {
    const asin = scrapeASIN();
    const productName = scrapeProductName();
    const price = scrapePrice();
    const image = scrapeImage();
    const productDetails = scrapeProductDetails();

    scrapeAllReviews(asin, 1000).then(reviews => {
      sendResponse({ productName, reviews, asin, price, image, productDetails });
    });
    return true;
  }
  return true;
});
