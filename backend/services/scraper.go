package services

import (
	"context"
	"fmt"
	"log"
	url_ "net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
	"github.com/scoogii/keypoints-backend/models"
)

// ScrapeReviews uses headless Chrome to scrape up to maxReviews from Amazon review pages.
// ScrapeResult holds scraped reviews and star distribution metadata.
type ScrapeResult struct {
	Reviews          []models.Review
	StarDistribution map[int]int // star level → percentage
}

func ScrapeReviews(asin string, domain string, maxReviews int, cookies string) (*ScrapeResult, error) {
	if asin == "" || domain == "" {
		return nil, fmt.Errorf("asin and domain are required")
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.UserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	// Set overall timeout
	ctx, cancel = context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()

	// Ensure browser is started before spawning tabs
	if err := chromedp.Run(ctx); err != nil {
		return nil, fmt.Errorf("failed to start browser: %w", err)
	}

	starFilterValues := []string{"five_star", "four_star", "three_star", "two_star", "one_star"}
	starNumbers := []int{5, 4, 3, 2, 1}

	// JS to scrape star distribution from histogram (present on every review page)
	starDistJS := `
		(() => {
			const pcts = {};
			const rows = document.querySelectorAll('#histogramTable tr, .cr-widget-Histogram tr, [data-hook="rating-histogram"] li');
			rows.forEach(row => {
				const link = row.querySelector('a[href*="filterByStar"]');
				if (!link) return;
				const match = link.href.match(/filterByStar=(\w+_star)/);
				if (!match) return;
				const pctEl = row.querySelector('.a-text-right .a-size-base, td:last-child .a-size-base, .a-text-right');
				if (pctEl) {
					const pctMatch = pctEl.textContent.trim().match(/(\d+)\s*%/);
					if (pctMatch) pcts[match[1]] = parseInt(pctMatch[1]);
				}
			});
			if (Object.keys(pcts).length === 0) {
				document.querySelectorAll('a[href*="filterByStar"]').forEach(a => {
					const match = a.href.match(/filterByStar=(\w+_star)/);
					if (!match) return;
					const ariaLabel = a.getAttribute('aria-label') || a.title || '';
					const pctMatch = ariaLabel.match(/(\d+)\s*%/);
					if (pctMatch) pcts[match[1]] = parseInt(pctMatch[1]);
				});
			}
			return pcts;
		})()`

	type starResult struct {
		star            int
		reviews         []models.Review
		starPercentages map[string]int
	}
	resultCh := make(chan starResult, 5)

	// Build cookie params once
	var cookieParams []*network.CookieParam
	if cookies != "" {
		parsedURL, _ := url_.Parse(domain)
		domainHost := parsedURL.Hostname()
		for _, c := range strings.Split(cookies, "; ") {
			parts := strings.SplitN(c, "=", 2)
			if len(parts) == 2 {
				cookieParams = append(cookieParams, &network.CookieParam{
					Name:   parts[0],
					Value:  parts[1],
					Domain: "." + domainHost,
					Path:   "/",
				})
			}
		}
	}

	for i, filterValue := range starFilterValues {
		go func(star int, filter string) {
			reviewURL := fmt.Sprintf("%s/product-reviews/%s/ref=cm_cr_dp_d_show_all_btm?ie=UTF8&reviewerType=all_reviews&filterByStar=%s", domain, asin, filter)

			tabCtx, tabCancel := chromedp.NewContext(ctx)
			defer tabCancel()

			if len(cookieParams) > 0 {
				chromedp.Run(tabCtx, network.SetCookies(cookieParams))
			}

			// Navigate and wait for reviews to appear (faster than fixed sleep)
			err := chromedp.Run(tabCtx,
				chromedp.Navigate(reviewURL),
				chromedp.WaitReady("body"),
			)
			if err != nil {
				log.Printf("[Scraper] %d-star: navigation error: %v", star, err)
				resultCh <- starResult{star: star}
				return
			}
			// Wait for reviews or timeout after 3s
			waitCtx, waitCancel := context.WithTimeout(tabCtx, 3*time.Second)
			chromedp.Run(waitCtx, chromedp.WaitVisible(`[data-hook="review"]`, chromedp.ByQuery))
			waitCancel()

			// Grab star distribution from this page's histogram
			var pageDist map[string]int
			chromedp.Run(tabCtx, chromedp.Evaluate(starDistJS, &pageDist))

			// Click "Show more reviews" up to 3 times
			scrapeJS := `
				(() => {
					const reviews = [];
					document.querySelectorAll('[data-hook="review"]').forEach(el => {
						const titleEl = el.querySelector('[data-hook="review-title"] span:last-child, [data-hook="review-title"]');
						const bodyEl = el.querySelector('[data-hook="review-body"]');
						const ratingEl = el.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]');
						const verifiedEl = el.querySelector('[data-hook="avp-badge"]');
						let title = titleEl ? titleEl.textContent.trim() : '';
						title = title.replace(/^\d+(\.\d+)?\s+out of\s+\d+\s+stars?\s*/i, '').trim();
						const body = bodyEl ? bodyEl.textContent.trim() : '';
						const ratingText = ratingEl ? ratingEl.textContent.trim() : '0';
						const ratingMatch = ratingText.match(/(\d)/);
						const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;
						const verified = !!verifiedEl;
						if (body) reviews.push({ title, rating, body, verified });
					});
					return reviews;
				})()`

			clickJS := `
				(() => {
					const btns = document.querySelectorAll('#cm_cr-pagination_bar a.a-button-text, #cm_cr-pagination_bar .a-button a');
					for (const btn of btns) {
						if (/show\s+\d+\s+more|next/i.test(btn.textContent)) {
							btn.scrollIntoView({block: 'center'});
							btn.click();
							return true;
						}
					}
					const allEls = [...document.querySelectorAll('a, button, span.a-button-inner a')];
					const btn = allEls.find(el => /more\s+review/i.test(el.textContent) && el.offsetParent !== null);
					if (btn) { btn.scrollIntoView({block: 'center'}); btn.click(); return true; }
					return false;
				})()`

			var prevCount int
			for click := 0; click < 2; click++ {
				var clicked bool
				chromedp.Run(tabCtx,
					chromedp.Evaluate(`window.scrollTo(0, document.body.scrollHeight)`, nil),
					chromedp.Sleep(250*time.Millisecond),
					chromedp.Evaluate(clickJS, &clicked),
				)
				if !clicked {
					break
				}
				log.Printf("[Scraper] %d-star: clicked 'show more' (click %d)", star, click+1)
				// Poll for new reviews to appear (up to 2s)
				for poll := 0; poll < 4; poll++ {
					chromedp.Run(tabCtx, chromedp.Sleep(500*time.Millisecond))
					var count int
					chromedp.Run(tabCtx, chromedp.Evaluate(`document.querySelectorAll('[data-hook="review"]').length`, &count))
					if count > prevCount {
						prevCount = count
						break
					}
				}
			}

			var reviews []models.Review
			chromedp.Run(tabCtx, chromedp.Evaluate(scrapeJS, &reviews))

			log.Printf("[Scraper] %d-star: found %d reviews total", star, len(reviews))
			resultCh <- starResult{star: star, reviews: reviews, starPercentages: pageDist}
		}(starNumbers[i], filterValue)
	}

	// Collect results and star distribution
	var allReviews []models.Review
	var starPercentages map[string]int
	seen := make(map[string]bool)
	for i := 0; i < 5; i++ {
		result := <-resultCh
		if starPercentages == nil && len(result.starPercentages) > 0 {
			starPercentages = result.starPercentages
		}
		for _, r := range result.reviews {
			key := r.Title + "|" + truncate(r.Body, 100)
			if !seen[key] {
				seen[key] = true
				allReviews = append(allReviews, r)
			}
		}
	}

	// Convert star distribution keys to int
	starDist := make(map[int]int)
	nameToStar := map[string]int{"five_star": 5, "four_star": 4, "three_star": 3, "two_star": 2, "one_star": 1}
	for name, pct := range starPercentages {
		if star, ok := nameToStar[name]; ok {
			starDist[star] = pct
		}
	}

	log.Printf("[Scraper] Star distribution: %v", starDist)

	log.Printf("[Scraper] Scrape complete for %s: %d total reviews", asin, len(allReviews))
	return &ScrapeResult{Reviews: allReviews, StarDistribution: starDist}, nil
}

// ScrapeReviewsFromPage scrapes reviews from the rendered Amazon page via JavaScript evaluation.
// This is used as a helper when chromedp evaluates JavaScript on the page.
func parseRating(s string) int {
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n, _ := strconv.Atoi(string(c))
			return n
		}
	}
	return 0
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Find a safe truncation point for multi-byte strings
	truncated := s[:n]
	if idx := strings.LastIndex(truncated, " "); idx > n/2 {
		return truncated[:idx]
	}
	return truncated
}
