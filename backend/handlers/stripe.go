package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/scoogii/keypoints-backend/middleware"
	"github.com/scoogii/keypoints-backend/services"
)

func CreateCheckoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := middleware.GetUserFromRequest(r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	user, err := services.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	var body struct {
		ReturnURL string `json:"returnUrl"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	returnURL := body.ReturnURL
	if returnURL == "" {
		returnURL = "https://www.amazon.com"
	}

	url, err := services.CreateCheckoutSession(user.ID, user.Email, returnURL)
	if err != nil {
		if err.Error() == "already subscribed" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "You already have an active subscription"})
			return
		}
		log.Printf("Error creating checkout session: %v", err)
		http.Error(w, "Failed to create checkout session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": url})
}

func CreatePortalHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := middleware.GetUserFromRequest(r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	user, err := services.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if user.StripeCustomerID == "" {
		http.Error(w, "No subscription found", http.StatusBadRequest)
		return
	}

	url, err := services.CreatePortalSession(user.StripeCustomerID)
	if err != nil {
		log.Printf("Error creating portal session: %v", err)
		http.Error(w, "Failed to create portal session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": url})
}

func WebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload, err := io.ReadAll(io.LimitReader(r.Body, 65536))
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	sigHeader := r.Header.Get("Stripe-Signature")
	if err := services.HandleWebhook(payload, sigHeader); err != nil {
		log.Printf("Webhook error: %v", err)
		http.Error(w, "Webhook error", http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
}
