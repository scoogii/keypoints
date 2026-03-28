// Content script - runs on Amazon product pages
// Scrapes reviews from the current page

function scrapeProductName() {
  const el = document.querySelector('#productTitle');
  return el ? el.textContent.trim() : 'Unknown Product';
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeReviews') {
    const productName = scrapeProductName();
    const reviews = scrapeReviews();
    sendResponse({ productName, reviews });
  }
  return true;
});
