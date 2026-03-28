package handlers

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"

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

	var count int
	if !isPremium {
		var err error
		count, err = services.GetAnalysisCountToday(clientIP)
		if err != nil {
			log.Printf("Error checking analysis count: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
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

	result, err := services.AnalyzeReviews(r.Context(), req.Reviews, req.ProductName)
	if err != nil {
		log.Printf("Error analyzing reviews: %v", err)
		http.Error(w, "Failed to analyze reviews", http.StatusInternalServerError)
		return
	}

	if err := services.LogAnalysis(clientIP, userID); err != nil {
		log.Printf("Error logging analysis: %v", err)
	}

	remaining := -1
	if !isPremium {
		remaining = 5 - count - 1
		if remaining < 0 {
			remaining = 0
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.AnalyzeResponseWrapper{
		AnalyzeResponse:   result,
		RemainingAnalyses: remaining,
	})
}
