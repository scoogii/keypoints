package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"strings"
	"time"

	oldgenai "github.com/google/generative-ai-go/genai"
	"github.com/scoogii/keypoints-backend/models"
	"google.golang.org/api/option"
	newgenai "google.golang.org/genai"
)

func AnalyzeReviews(ctx context.Context, reviews []models.Review, productName string, starDist map[int]int) (*models.AnalyzeResponse, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := newgenai.NewClient(ctx, &newgenai.ClientConfig{
		APIKey:  apiKey,
		Backend: newgenai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}

	totalCount := len(reviews)
	sampled := sampleReviews(reviews, 50)
	prompt := buildAnalyzePrompt(sampled, totalCount, productName, starDist)

	geminiCtx, geminiCancel := context.WithTimeout(ctx, 30*time.Second)
	defer geminiCancel()

	temp := float32(0.3)
	thinkingBudget := int32(0)
	resp, err := client.Models.GenerateContent(geminiCtx, "gemini-2.5-flash",
		[]*newgenai.Content{{Parts: []*newgenai.Part{{Text: prompt}}}},
		&newgenai.GenerateContentConfig{
			Temperature:  &temp,
			ThinkingConfig: &newgenai.ThinkingConfig{
				ThinkingBudget: &thinkingBudget,
			},
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to generate content: %w", err)
	}

	respText := resp.Text()

	jsonStr := extractJSON(respText)

	var result models.AnalyzeResponse
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, fmt.Errorf("failed to parse Gemini response as JSON: %w\nraw response: %s", err, respText)
	}

	return &result, nil
}

func Chat(ctx context.Context, reviews []models.Review, productName string, productDetails models.ProductDetails, question string) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY environment variable is not set")
	}

	client, err := oldgenai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return "", fmt.Errorf("failed to create Gemini client: %w", err)
	}
	defer client.Close()

	model := client.GenerativeModel("gemini-2.5-flash")
	model.SetTemperature(0.5)

	prompt := buildChatPrompt(reviews, productName, productDetails, question)

	resp, err := model.GenerateContent(ctx, oldgenai.Text(prompt))
	if err != nil {
		return "", fmt.Errorf("failed to generate content: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from Gemini")
	}

	text, ok := resp.Candidates[0].Content.Parts[0].(oldgenai.Text)
	if !ok {
		return "", fmt.Errorf("unexpected response type from Gemini")
	}

	return string(text), nil
}

// sampleReviews returns a stratified sample of reviews by star rating.
// If there are fewer reviews than maxSample, all reviews are returned.
func sampleReviews(reviews []models.Review, maxSample int) []models.Review {
	if len(reviews) <= maxSample {
		return reviews
	}

	// Group reviews by star rating (1-5)
	buckets := make(map[int][]models.Review)
	for _, r := range reviews {
		rating := r.Rating
		if rating < 1 {
			rating = 1
		} else if rating > 5 {
			rating = 5
		}
		buckets[rating] = append(buckets[rating], r)
	}

	// Calculate proportional sample size per bucket
	sampled := make([]models.Review, 0, maxSample)
	total := len(reviews)

	for rating := 1; rating <= 5; rating++ {
		bucket := buckets[rating]
		if len(bucket) == 0 {
			continue
		}

		// Proportional allocation
		n := (len(bucket) * maxSample) / total
		if n < 1 {
			n = 1
		}
		if n > len(bucket) {
			n = len(bucket)
		}

		// Shuffle and take n
		rand.Shuffle(len(bucket), func(i, j int) {
			bucket[i], bucket[j] = bucket[j], bucket[i]
		})
		sampled = append(sampled, bucket[:n]...)
	}

	// If rounding left us short, fill from remaining reviews
	if len(sampled) < maxSample {
		seen := make(map[int]bool)
		for i, r := range reviews {
			for _, s := range sampled {
				if r.Title == s.Title && r.Body == s.Body {
					seen[i] = true
					break
				}
			}
		}
		for i, r := range reviews {
			if len(sampled) >= maxSample {
				break
			}
			if !seen[i] {
				sampled = append(sampled, r)
			}
		}
	}

	// Trim if rounding gave us too many
	if len(sampled) > maxSample {
		sampled = sampled[:maxSample]
	}

	return sampled
}

func buildAnalyzePrompt(reviews []models.Review, totalReviewCount int, productName string, starDist map[int]int) string {
	var sb strings.Builder

	if len(reviews) < totalReviewCount {
		sb.WriteString(fmt.Sprintf("Analyze the following representative sample of %d reviews (from %d total) for the Amazon product \"%s\".\n\n", len(reviews), totalReviewCount, productName))
	} else {
		sb.WriteString(fmt.Sprintf("Analyze the following %d Amazon product reviews for \"%s\".\n\n", len(reviews), productName))
	}

	// Include actual star distribution for accurate sentiment calculation
	if len(starDist) > 0 {
		sb.WriteString("ACTUAL STAR RATING DISTRIBUTION (use this for sentiment score, NOT the sample distribution):\n")
		for star := 5; star >= 1; star-- {
			if pct, ok := starDist[star]; ok {
				sb.WriteString(fmt.Sprintf("  %d star: %d%%\n", star, pct))
			}
		}
		sb.WriteString("NOTE: The reviews below are intentionally sampled equally across star levels to give you diverse material for pros, cons, and fake detection. Base the sentimentScore on the ACTUAL distribution above, not the sample.\n\n")
	}

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
  "summary": "string",
  "fakeReviewFlags": [{"reviewTitle": "string", "reason": "string", "confidence": <number 0-1>}],
  "categoryHighlights": [{"category": "string", "points": ["string"]}]
}

Instructions:
- "pros": Top 3-5 most mentioned positives. Keep each point to one short sentence. ONLY include points explicitly stated in reviews.
- "cons": Top 3-5 most mentioned negatives. Keep each point to one short sentence. ONLY include points explicitly stated in reviews.
- "sentimentScore": Overall sentiment from 0 (very negative) to 100 (very positive). If a star distribution is provided above, calculate as: ((5star%×100 + 4star%×75 + 3star%×50 + 2star%×25 + 1star%×0) / 100). For example, 83% 5-star, 9% 4-star, 3% 3-star, 1% 2-star, 4% 1-star = (83×100+9×75+3×50+1×25+4×0)/100 = 90. Round to nearest integer.
- "sentimentLabel": One of "Very Negative" (0-20), "Negative" (21-40), "Mixed" (41-60), "Positive" (61-80), "Very Positive" (81-100).
- "summary": Start with one brief sentence describing what the product is, then 1-2 sentences summarizing the overall review consensus. Be clear and concise. ONLY state what reviewers actually said — do NOT invent or assume anything.
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
