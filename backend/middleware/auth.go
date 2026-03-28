package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/scoogii/keypoints-backend/services"
)

func GetUserFromRequest(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", fmt.Errorf("missing Authorization header")
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", fmt.Errorf("invalid Authorization header format")
	}

	return services.ValidateJWT(parts[1])
}
