#!/bin/bash
# Start both Stripe webhook listener and Go backend

stripe listen --forward-to localhost:8080/api/stripe/webhook &
STRIPE_PID=$!

go run main.go &
GO_PID=$!

trap "kill $STRIPE_PID $GO_PID 2>/dev/null" EXIT

echo "🚀 Backend and Stripe listener running. Press Ctrl+C to stop."
wait
