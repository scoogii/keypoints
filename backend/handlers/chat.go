package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/scoogii/keypoints-backend/middleware"
	"github.com/scoogii/keypoints-backend/models"
	"github.com/scoogii/keypoints-backend/services"
)

func ChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := middleware.GetUserFromRequest(r)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
		return
	}

	user, err := services.GetUserByID(userID)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "User not found"})
		return
	}

	if !user.IsPremium {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		json.NewEncoder(w).Encode(map[string]string{"error": "Premium feature - subscription required"})
		return
	}

	var req models.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	answer, err := services.Chat(r.Context(), req.Reviews, req.ProductName, req.ProductDetails, req.Question)
	if err != nil {
		log.Printf("Error in chat: %v", err)
		http.Error(w, "Failed to process chat", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.ChatResponse{Answer: answer})
}
