package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/google/generative-ai-go/genai"
	"github.com/scoogii/keypoints-backend/models"
	"google.golang.org/api/option"
)

func AnalyzeReviews(ctx context.Context, reviews []models.Review, productName string) (*models.AnalyzeResponse, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}
	defer client.Close()

	model := client.GenerativeModel("gemini-2.5-flash")
	model.SetTemperature(0.3)

	prompt := buildAnalyzePrompt(reviews, productName)

	resp, err := model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return nil, fmt.Errorf("failed to generate content: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty response from Gemini")
	}

	text, ok := resp.Candidates[0].Content.Parts[0].(genai.Text)
	if !ok {
		return nil, fmt.Errorf("unexpected response type from Gemini")
	}

	jsonStr := extractJSON(string(text))

	var result models.AnalyzeResponse
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, fmt.Errorf("failed to parse Gemini response as JSON: %w\nraw response: %s", err, string(text))
	}

	return &result, nil
}

func Chat(ctx context.Context, reviews []models.Review, productName string, question string) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return "", fmt.Errorf("failed to create Gemini client: %w", err)
	}
	defer client.Close()

	model := client.GenerativeModel("gemini-2.5-flash")
	model.SetTemperature(0.5)

	prompt := buildChatPrompt(reviews, productName, question)

	resp, err := model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return "", fmt.Errorf("failed to generate content: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from Gemini")
	}

	text, ok := resp.Candidates[0].Content.Parts[0].(genai.Text)
	if !ok {
		return "", fmt.Errorf("unexpected response type from Gemini")
	}

	return string(text), nil
}

func buildAnalyzePrompt(reviews []models.Review, productName string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("Analyze the following Amazon product reviews for \"%s\".\n\n", productName))

	sb.WriteString("Reviews:\n")
	for i, r := range reviews {
		verified := "No"
		if r.Verified {
			verified = "Yes"
		}
		sb.WriteString(fmt.Sprintf("--- Review %d ---\nTitle: %s\nRating: %d/5\nVerified Purchase: %s\nBody: %s\n\n", i+1, r.Title, r.Rating, verified, r.Body))
	}

	sb.WriteString(`Respond with ONLY a valid JSON object (no markdown, no code fences) matching this exact structure:
{
  "pros": [{"point": "string"}],
  "cons": [{"point": "string"}],
  "sentimentScore": <number 0-100>,
  "sentimentLabel": "<Very Negative|Negative|Mixed|Positive|Very Positive>",
  "fakeReviewFlags": [{"reviewTitle": "string", "reason": "string", "confidence": <number 0-1>}],
  "categoryHighlights": [{"category": "string", "points": ["string"]}]
}

Instructions:
- "pros": Extract the most frequently mentioned positive aspects across all reviews. Each point should be a concise, clear statement.
- "cons": Extract the most frequently mentioned negative aspects across all reviews. Each point should be a concise, clear statement.
- "sentimentScore": Overall sentiment from 0 (very negative) to 100 (very positive) based on all reviews.
- "sentimentLabel": One of "Very Negative" (0-20), "Negative" (21-40), "Mixed" (41-60), "Positive" (61-80), "Very Positive" (81-100).
- "fakeReviewFlags": Flag any reviews that appear suspicious. Look for: generic/vague language lacking specific details, suspiciously short reviews, signs of incentivized reviews, reviews that don't match the product, identical or near-identical phrasing across reviews, extreme ratings with no justification. Set confidence from 0 to 1. If no suspicious reviews are found, return an empty array.
- "categoryHighlights": Group insights into relevant categories such as durability, value, comfort, quality, performance, design, ease of use, etc. Only include categories that are actually discussed in the reviews.
`)

	return sb.String()
}

func buildChatPrompt(reviews []models.Review, productName string, question string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("You are a helpful assistant that answers questions about Amazon product reviews for \"%s\".\n\n", productName))

	sb.WriteString("Here are the reviews:\n")
	for i, r := range reviews {
		sb.WriteString(fmt.Sprintf("--- Review %d ---\nTitle: %s\nRating: %d/5\nBody: %s\n\n", i+1, r.Title, r.Rating, r.Body))
	}

	sb.WriteString(fmt.Sprintf("User question: %s\n\nProvide a helpful, concise answer based on the reviews above.", question))

	return sb.String()
}

func extractJSON(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	}
	return s
}
