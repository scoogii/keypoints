package middleware

import (
	"net/http"

	"golang.org/x/time/rate"
)

var globalLimiter = rate.NewLimiter(10, 20)

func RateLimit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !globalLimiter.Allow() {
			http.Error(w, "Too many requests, please try again later", http.StatusTooManyRequests)
			return
		}
		next(w, r)
	}
}
