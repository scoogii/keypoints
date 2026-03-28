package main

import (
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/scoogii/keypoints-backend/handlers"
	"github.com/scoogii/keypoints-backend/middleware"
	"github.com/scoogii/keypoints-backend/services"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	if err := services.InitDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/api/analyze", handlers.AnalyzeHandler)
	mux.HandleFunc("/api/analyze/remaining", handlers.RemainingHandler)
	mux.HandleFunc("/api/chat", handlers.ChatHandler)

	mux.HandleFunc("/api/auth/google", handlers.GoogleAuthHandler)
	mux.HandleFunc("/api/auth/me", handlers.MeHandler)

	mux.HandleFunc("/api/stripe/create-checkout", handlers.CreateCheckoutHandler)
	mux.HandleFunc("/api/stripe/create-portal", handlers.CreatePortalHandler)
	mux.HandleFunc("/api/stripe/webhook", handlers.WebhookHandler)

	handler := middleware.CORS(mux)

	log.Println("Sift backend starting on :8080")
	if origin := os.Getenv("CORS_ALLOWED_ORIGIN"); origin != "" {
		log.Printf("CORS: production mode, allowing origin: %s", origin)
	} else {
		log.Println("CORS: development mode, allowing chrome-extension:// and localhost")
	}
	if err := http.ListenAndServe(":8080", handler); err != nil {
		log.Fatal(err)
	}
}
