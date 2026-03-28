package services

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/scoogii/keypoints-backend/models"
)

var db *sql.DB

func InitDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable is not set")
	}

	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return err
	}

	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	_, err = db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
		email TEXT NOT NULL,
		name TEXT NOT NULL,
		google_id TEXT UNIQUE NOT NULL,
		stripe_customer_id TEXT DEFAULT '',
		is_premium BOOLEAN DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS analysis_logs (
		id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
		ip_address TEXT NOT NULL,
		install_id TEXT NOT NULL DEFAULT '',
		user_id UUID,
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	if err != nil {
		return err
	}

	db.Exec(`ALTER TABLE analysis_logs ADD COLUMN IF NOT EXISTS install_id TEXT NOT NULL DEFAULT ''`)

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_analysis_logs_ip_created ON analysis_logs (ip_address, created_at)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_analysis_logs_install_created ON analysis_logs (install_id, created_at)`)
	return err
}

func GetAnalysisCountLast24h(ip string) (int, error) {
	var count int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM analysis_logs WHERE ip_address = $1 AND created_at >= NOW() - INTERVAL '24 hours'",
		ip,
	).Scan(&count)
	return count, err
}

func GetAnalysisCountByInstallID(installID string) (int, error) {
	var count int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM analysis_logs WHERE install_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'",
		installID,
	).Scan(&count)
	return count, err
}

func LogAnalysis(ip string, installID string, userID string) error {
	var uid interface{}
	if userID != "" {
		uid = userID
	}
	_, err := db.Exec(
		"INSERT INTO analysis_logs (id, ip_address, install_id, user_id, created_at) VALUES ($1, $2, $3, $4, NOW())",
		uuid.New().String(), ip, installID, uid,
	)
	return err
}

func GetUserByGoogleID(googleID string) (*models.User, error) {
	var u models.User
	err := db.QueryRow(
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE google_id = $1",
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
		"INSERT INTO users (id, email, name, google_id, stripe_customer_id, is_premium, created_at) VALUES ($1, $2, $3, $4, '', FALSE, $5)",
		u.ID, u.Email, u.Name, u.GoogleID, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func UpdateStripeCustomerID(userID, customerID string) error {
	_, err := db.Exec("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", customerID, userID)
	return err
}

func UpdatePremiumStatus(userID string, isPremium bool) error {
	_, err := db.Exec("UPDATE users SET is_premium = $1 WHERE id = $2", isPremium, userID)
	return err
}

func GetUserByID(userID string) (*models.User, error) {
	var u models.User
	err := db.QueryRow(
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE id = $1",
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
		"SELECT id, email, name, google_id, stripe_customer_id, is_premium, created_at FROM users WHERE stripe_customer_id = $1",
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
