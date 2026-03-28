package services

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/customer"
	"github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/webhook"
)

func initStripe() {
	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")
}

func CreateCheckoutSession(userID, email, returnURL string) (string, error) {
	initStripe()
	priceID := os.Getenv("STRIPE_PRICE_ID")

	// Search for existing customer by email
	params := &stripe.CustomerListParams{}
	params.Filters.AddFilter("email", "", email)
	params.Single = true

	var cust *stripe.Customer
	iter := customer.List(params)
	if iter.Next() {
		cust = iter.Customer()
	} else {
		// Create new customer
		cp := &stripe.CustomerParams{
			Email: stripe.String(email),
		}
		var err error
		cust, err = customer.New(cp)
		if err != nil {
			return "", fmt.Errorf("failed to create Stripe customer: %w", err)
		}
	}

	// Check for existing active subscription
	subParams := &stripe.SubscriptionListParams{
		Customer: stripe.String(cust.ID),
		Status:   stripe.String("active"),
	}
	subIter := subscription.List(subParams)
	if subIter.Next() {
		return "", fmt.Errorf("already subscribed")
	}

	checkoutParams := &stripe.CheckoutSessionParams{
		Mode: stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL:        stripe.String(returnURL),
		CancelURL:         stripe.String(returnURL),
		ClientReferenceID: stripe.String(userID),
		Customer:          stripe.String(cust.ID),
	}

	s, err := checkoutsession.New(checkoutParams)
	if err != nil {
		return "", fmt.Errorf("failed to create checkout session: %w", err)
	}

	return s.URL, nil
}

func CreatePortalSession(stripeCustomerID string) (string, error) {
	initStripe()

	params := &stripe.BillingPortalSessionParams{
		Customer: stripe.String(stripeCustomerID),
	}

	s, err := session.New(params)
	if err != nil {
		return "", fmt.Errorf("failed to create portal session: %w", err)
	}

	return s.URL, nil
}

func HandleWebhook(payload []byte, sigHeader string) error {
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")

	event, err := webhook.ConstructEventWithOptions(payload, sigHeader, webhookSecret, webhook.ConstructEventOptions{
		IgnoreAPIVersionMismatch: true,
	})
	if err != nil {
		return fmt.Errorf("webhook signature verification failed: %w", err)
	}

	switch event.Type {
	case "checkout.session.completed":
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
			return fmt.Errorf("failed to parse checkout session: %w", err)
		}
		userID := session.ClientReferenceID
		if userID != "" {
			if err := UpdateStripeCustomerID(userID, session.Customer.ID); err != nil {
				return fmt.Errorf("failed to update stripe customer ID: %w", err)
			}
			if err := UpdatePremiumStatus(userID, true); err != nil {
				return fmt.Errorf("failed to update premium status: %w", err)
			}
		}

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			return fmt.Errorf("failed to parse subscription: %w", err)
		}
		user, err := GetUserByStripeCustomerID(sub.Customer.ID)
		if err != nil {
			return fmt.Errorf("failed to find user: %w", err)
		}
		if user != nil {
			if err := UpdatePremiumStatus(user.ID, false); err != nil {
				return fmt.Errorf("failed to update premium status: %w", err)
			}
		}

	case "invoice.payment_failed":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
			return fmt.Errorf("failed to parse invoice: %w", err)
		}
		user, err := GetUserByStripeCustomerID(inv.Customer.ID)
		if err != nil {
			return fmt.Errorf("failed to find user: %w", err)
		}
		if user != nil {
			if err := UpdatePremiumStatus(user.ID, false); err != nil {
				return fmt.Errorf("failed to update premium status: %w", err)
			}
		}
	}

	return nil
}
