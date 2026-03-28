package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimitAllowsNormalTraffic(t *testing.T) {
	handler := RateLimit(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/analyze", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rec.Code)
		}
	}
}

func TestRateLimitBlocksExcessTraffic(t *testing.T) {
	// Reset the global limiter for a clean test
	globalLimiter.SetLimit(10)
	globalLimiter.SetBurst(5)

	handler := RateLimit(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	blocked := 0
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/analyze", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			blocked++
		}
	}

	if blocked == 0 {
		t.Fatal("expected some requests to be rate limited, but none were")
	}

	// Restore defaults
	globalLimiter.SetLimit(10)
	globalLimiter.SetBurst(20)
}
