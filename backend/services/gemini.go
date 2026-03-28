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

func Chat(ctx context.Context, reviews []models.Review, productName string, productDetails models.ProductDetails, question string) (string, error) {
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

	prompt := buildChatPrompt(reviews, productName, productDetails, question)

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
- "pros": Top 3-5 most mentioned positives. Keep each point to one short sentence. ONLY include points explicitly stated in reviews.
- "cons": Top 3-5 most mentioned negatives. Keep each point to one short sentence. ONLY include points explicitly stated in reviews.
- "sentimentScore": Overall sentiment from 0 (very negative) to 100 (very positive) based on all reviews.
- "sentimentLabel": One of "Very Negative" (0-20), "Negative" (21-40), "Mixed" (41-60), "Positive" (61-80), "Very Positive" (81-100).
- "fakeReviewFlags": Only flag reviews with HIGH confidence (>0.7) of being fake. Look for: generic/vague language, incentivized reviews, identical phrasing. Maximum 3 flags. If none are clearly suspicious, return an empty array. Do NOT flag reviews just for being short or having strong opinions.
- "categoryHighlights": Maximum 3-4 categories. Each category should have 2-3 concise points maximum. Only include categories clearly discussed in reviews.
- CRITICAL: Do NOT invent, assume, or hallucinate any information. Every point must be directly supported by the review text provided.
`)

	return sb.String()
}

func buildChatPrompt(reviews []models.Review, productName string, details models.ProductDetails, question string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("You are a helpful assistant that answers questions about the Amazon product \"%s\".\n\n", productName))
	sb.WriteString("IMPORTANT RULES:\n")
	sb.WriteString("- ONLY answer based on the product information and reviews provided below.\n")
	sb.WriteString("- If the answer is not found in the provided information, say \"I don't have enough information from this product page to answer that.\"\n")
	sb.WriteString("- NEVER make up or guess information that is not explicitly stated in the data below.\n")
	sb.WriteString("- Be concise and helpful.\n\n")

	// Product details
	sb.WriteString("=== PRODUCT INFORMATION ===\n")
	if details.Price != "" {
		sb.WriteString(fmt.Sprintf("Price: %s\n", details.Price))
	}
	if details.OverallRating != "" {
		sb.WriteString(fmt.Sprintf("Rating: %s\n", details.OverallRating))
	}
	if details.TotalReviews != "" {
		sb.WriteString(fmt.Sprintf("Total Reviews: %s\n", details.TotalReviews))
	}
	if len(details.Features) > 0 {
		sb.WriteString("\nFeatures:\n")
		for _, f := range details.Features {
			sb.WriteString(fmt.Sprintf("• %s\n", f))
		}
	}
	if details.Description != "" {
		sb.WriteString(fmt.Sprintf("\nDescription:\n%s\n", details.Description))
	}
	if len(details.Specifications) > 0 {
		sb.WriteString("\nSpecifications:\n")
		for k, v := range details.Specifications {
			sb.WriteString(fmt.Sprintf("  %s: %s\n", k, v))
		}
	}
	if details.ManufacturerInfo != "" {
		sb.WriteString(fmt.Sprintf("\nManufacturer Info:\n%s\n", details.ManufacturerInfo))
	}

	// Reviews
	if len(reviews) > 0 {
		sb.WriteString("\n=== CUSTOMER REVIEWS ===\n")
		for i, r := range reviews {
			sb.WriteString(fmt.Sprintf("--- Review %d ---\nTitle: %s\nRating: %d/5\nBody: %s\n\n", i+1, r.Title, r.Rating, r.Body))
		}
	}

	sb.WriteString(fmt.Sprintf("\nUser question: %s", question))

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
