package services

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/scoogii/keypoints-backend/models"
	_ "modernc.org/sqlite"
)

var db *sql.DB

func InitDB() error {
	var err error
	db, err = sql.Open("sqlite", "keypoints.db")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL,
		name TEXT NOT NULL,
		google_id TEXT UNIQUE NOT NULL,
		stripe_customer_id TEXT DEFAULT '',
		is_premium BOOLEAN DEFAULT 0,
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS analysis_logs (
		id TEXT PRIMARY KEY,
		ip_address TEXT NOT NULL,
		user_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	return err
}

func GetAnalysisCountToday(ip string) (int, error) {
	var count int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM analysis_logs WHERE ip_address = ? AND DATE(created_at) = DATE('now')",
		ip,
	).Scan(&count)
	return count, err
}

func LogAnalysis(ip string, userID string) error {
	_, err := db.Exec(
		"INSERT INTO analysis_logs (id, ip_address, user_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
		uuid.New().String(), ip, userID,
	)
	return err
}

func GetUserByGoogleID(googleID string) (*models.User, error) {
	var u models.User
	err := db.QueryRow(
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE google_id = ?",
		googleID,
	).Scan(&u.ID, &u.Email, &u.Name, &u.GoogleID, &u.StripeCustomerID, &u.IsPremium, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func CreateUser(email, name, googleID string) (*models.User, error) {
	u := &models.User{
		ID:        uuid.New().String(),
		Email:     email,
		Name:      name,
		GoogleID:  googleID,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	_, err := db.Exec(
		"INSERT INTO users (id, email, name, google_id, stripe_customer_id, is_premium, created_at) VALUES (?, ?, ?, ?, '', 0, ?)",
		u.ID, u.Email, u.Name, u.GoogleID, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func UpdateStripeCustomerID(userID, customerID string) error {
	_, err := db.Exec("UPDATE users SET stripe_customer_id = ? WHERE id = ?", customerID, userID)
	return err
}

func UpdatePremiumStatus(userID string, isPremium bool) error {
	_, err := db.Exec("UPDATE users SET is_premium = ? WHERE id = ?", isPremium, userID)
	return err
}

func GetUserByID(userID string) (*models.User, error) {
	var u models.User
	err := db.QueryRow(
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE id = ?",
		userID,
	).Scan(&u.ID, &u.Email, &u.Name, &u.GoogleID, &u.StripeCustomerID, &u.IsPremium, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func GetUserByStripeCustomerID(customerID string) (*models.User, error) {
	var u models.User
	err := db.QueryRow(
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE stripe_customer_id = ?",
		customerID,
	).Scan(&u.ID, &u.Email, &u.Name, &u.GoogleID, &u.StripeCustomerID, &u.IsPremium, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
