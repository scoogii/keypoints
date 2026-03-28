package models

type User struct {
	ID               string `json:"id"`
	Email            string `json:"email"`
	Name             string `json:"name"`
	GoogleID         string `json:"googleId"`
	StripeCustomerID string `json:"stripeCustomerId,omitempty"`
	IsPremium        bool   `json:"isPremium"`
	CreatedAt        string `json:"createdAt"`
}

type AuthRequest struct {
	GoogleToken string `json:"googleToken"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}
