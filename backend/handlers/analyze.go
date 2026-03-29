package handlers

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/scoogii/keypoints-backend/middleware"
	"github.com/scoogii/keypoints-backend/models"
	"github.com/scoogii/keypoints-backend/services"
)

func getClientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		ip := strings.SplitN(forwarded, ",", 2)[0]
		return strings.TrimSpace(ip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func RemainingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientIP := getClientIP(r)
	isPremium := false

	if uid, err := middleware.GetUserFromRequest(r); err == nil {
		if user, err := services.GetUserByID(uid); err == nil && user != nil {
			isPremium = user.IsPremium
		}
	}

	if isPremium {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"remaining": -1})
		return
	}

	count, err := services.GetAnalysisCountLast24h(clientIP)
	if err != nil {
		log.Printf("Error checking analysis count: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if installID := r.Header.Get("X-Install-ID"); installID != "" {
		if installCount, err := services.GetAnalysisCountByInstallID(installID); err == nil && installCount > count {
			count = installCount
		}
	}

	remaining := 5 - count
	if remaining < 0 {
		remaining = 0
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"remaining": remaining})
}

func AnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req models.AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Reviews) == 0 {
		http.Error(w, "No reviews provided", http.StatusBadRequest)
		return
	}

	clientIP := getClientIP(r)
	userID := ""
	isPremium := false

	if uid, err := middleware.GetUserFromRequest(r); err == nil {
		userID = uid
		if user, err := services.GetUserByID(userID); err == nil && user != nil {
			isPremium = user.IsPremium
		}
	}

	installID := r.Header.Get("X-Install-ID")

	var count int
	if !isPremium {
		var err error
		count, err = services.GetAnalysisCountLast24h(clientIP)
		if err != nil {
			log.Printf("Error checking analysis count: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		if installID != "" {
			installCount, err := services.GetAnalysisCountByInstallID(installID)
			if err != nil {
				log.Printf("Error checking install ID analysis count: %v", err)
			} else if installCount > count {
				count = installCount
			}
		}

		if count >= 5 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":     "Free tier limit reached. You can analyze up to 5 products per day. Upgrade to Premium for unlimited access.",
				"remaining": 0,
			})
			return
		}
	}

	// Deep scrape reviews from Amazon if ASIN and domain are provided
	analyzeStart := time.Now()
	reviews := req.Reviews
	var starDist map[int]int
	if req.ASIN != "" && req.Domain != "" {
		scrapeStart := time.Now()
		scrapeResult, err := services.ScrapeReviews(req.ASIN, req.Domain, 1000, req.Cookies)
		log.Printf("[Timing] Scrape took %v", time.Since(scrapeStart))
		if err != nil {
			log.Printf("Scraper error (using on-page reviews): %v", err)
		} else if len(scrapeResult.Reviews) > len(reviews) {
			// Merge: start with scraped, add any on-page reviews not already present
			seen := make(map[string]bool)
			for _, r := range scrapeResult.Reviews {
				key := r.Title + "|" + r.Body
				seen[key] = true
			}
			for _, r := range reviews {
				key := r.Title + "|" + r.Body
				if !seen[key] {
					scrapeResult.Reviews = append(scrapeResult.Reviews, r)
				}
			}
			reviews = scrapeResult.Reviews
			starDist = scrapeResult.StarDistribution
			log.Printf("Deep scrape: %d total reviews for %s", len(reviews), req.ASIN)
		}
	}

	geminiStart := time.Now()
	result, err := services.AnalyzeReviews(r.Context(), reviews, req.ProductName, starDist)
	log.Printf("[Timing] Gemini took %v", time.Since(geminiStart))
	if err != nil {
		log.Printf("Error analyzing reviews: %v", err)
		http.Error(w, "Failed to analyze reviews", http.StatusInternalServerError)
		return
	}

	if err := services.LogAnalysis(clientIP, installID, userID); err != nil {
		log.Printf("Error logging analysis: %v", err)
	}

	remaining := -1
	if !isPremium {
		remaining = 5 - count - 1
		if remaining < 0 {
			remaining = 0
		}
	}

	log.Printf("[Timing] Total analyze request took %v", time.Since(analyzeStart))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.AnalyzeResponseWrapper{
		AnalyzeResponse:   result,
		RemainingAnalyses: remaining,
	})
}
