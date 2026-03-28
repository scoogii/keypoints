package models

type Review struct {
	Title    string `json:"title"`
	Rating   int    `json:"rating"`
	Body     string `json:"body"`
	Verified bool   `json:"verified"`
}

type AnalyzeRequest struct {
	Reviews     []Review `json:"reviews"`
	ProductName string   `json:"productName"`
}

type ProCon struct {
	Point string `json:"point"`
}

type FakeReviewFlag struct {
	ReviewTitle string  `json:"reviewTitle"`
	Reason      string  `json:"reason"`
	Confidence  float64 `json:"confidence"`
}

type CategoryHighlight struct {
	Category string   `json:"category"`
	Points   []string `json:"points"`
}

type AnalyzeResponse struct {
	Pros               []ProCon            `json:"pros"`
	Cons               []ProCon            `json:"cons"`
	SentimentScore     float64             `json:"sentimentScore"`
	SentimentLabel     string              `json:"sentimentLabel"`
	FakeReviewFlags    []FakeReviewFlag    `json:"fakeReviewFlags"`
	CategoryHighlights []CategoryHighlight `json:"categoryHighlights"`
}

type AnalyzeResponseWrapper struct {
	*AnalyzeResponse
	RemainingAnalyses int `json:"remainingAnalyses"`
}

type ChatRequest struct {
	Reviews     []Review `json:"reviews"`
	ProductName string   `json:"productName"`
	Question    string   `json:"question"`
}

type ChatResponse struct {
	Answer string `json:"answer"`
}
