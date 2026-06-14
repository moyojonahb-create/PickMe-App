package reputation

import (
	"context"
	"log"
	"math"
	"time"
)

type Repository interface {
	Get(ctx context.Context, driverID string) (DriverReputation, error)
	Save(ctx context.Context, before DriverReputation, after DriverReputation, event Event) error
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

func Neutral(driverID string) DriverReputation {
	now := time.Now().UTC()
	return DriverReputation{
		DriverID:         driverID,
		AcceptanceRate:   0.5,
		CompletionRate:   0.5,
		ReliabilityScore: 0.5,
		FreshnessScore:   0.5,
		DispatchScore:    0.5,
		UpdatedAt:        now,
	}
}

func (s *Service) DispatchScore(ctx context.Context, driverID string) float64 {
	if s == nil || s.repo == nil || driverID == "" {
		return 0.5
	}
	rep, err := s.repo.Get(ctx, driverID)
	if err != nil {
		return 0.5
	}
	return clamp01(rep.DispatchScore)
}

func (s *Service) RecordOfferSent(ctx context.Context, driverIDs []string, rideID string) {
	if s == nil || s.repo == nil {
		return
	}
	for _, driverID := range uniqueNonEmpty(driverIDs) {
		s.recordAsync(Event{DriverID: driverID, Type: EventOfferSent, RideID: rideID})
	}
}

func (s *Service) RecordOfferSubmitted(ctx context.Context, driverID string, rideID string, offerID string) {
	s.recordAsync(Event{DriverID: driverID, Type: EventOfferSubmitted, RideID: rideID, OfferID: offerID})
}

func (s *Service) RecordOfferAccepted(ctx context.Context, driverID string, rideID string, offerID string) {
	s.recordAsync(Event{DriverID: driverID, Type: EventOfferAccepted, RideID: rideID, OfferID: offerID})
}

func (s *Service) RecordRideCompleted(ctx context.Context, driverID string, rideID string) {
	s.recordAsync(Event{DriverID: driverID, Type: EventRideCompleted, RideID: rideID})
}

func (s *Service) RecordRideCancelled(ctx context.Context, driverID string, rideID string) {
	s.recordAsync(Event{DriverID: driverID, Type: EventRideCancelled, RideID: rideID})
}

func (s *Service) RecordLocationFreshness(ctx context.Context, driverID string, fresh bool) {
	metadata := map[string]any{"fresh": fresh}
	s.recordAsync(Event{DriverID: driverID, Type: EventLocationFreshness, Metadata: metadata})
}

func (s *Service) ApplyEventSync(ctx context.Context, event Event) (DriverReputation, error) {
	if s == nil || s.repo == nil || event.DriverID == "" {
		return Neutral(event.DriverID), nil
	}
	if event.At.IsZero() {
		event.At = s.now().UTC()
	}
	before, err := s.repo.Get(ctx, event.DriverID)
	if err != nil {
		before = Neutral(event.DriverID)
	}
	after := ApplyEvent(before, event)
	if err := s.repo.Save(ctx, before, after, event); err != nil {
		return after, err
	}
	return after, nil
}

func (s *Service) recordAsync(event Event) {
	if s == nil || s.repo == nil || event.DriverID == "" {
		return
	}
	go func() {
		if _, err := s.ApplyEventSync(context.Background(), event); err != nil {
			log.Println("Driver reputation update warning:", err)
		}
	}()
}

func ApplyEvent(rep DriverReputation, event Event) DriverReputation {
	if rep.DriverID == "" {
		rep = Neutral(event.DriverID)
	}
	switch event.Type {
	case EventOfferSent:
		rep.OfferedRides++
		rep.LastOfferAt = timePtr(event.At)
	case EventOfferSubmitted:
		rep.LastOfferAt = timePtr(event.At)
	case EventOfferAccepted:
		rep.AcceptedRides++
		rep.LastOfferAt = timePtr(event.At)
	case EventRideCompleted:
		rep.CompletedRides++
		rep.LastCompletedRideAt = timePtr(event.At)
	case EventRideCancelled:
		rep.CancelledRides++
	case EventLocationFreshness:
		if fresh, ok := event.Metadata["fresh"].(bool); ok && fresh {
			rep.FreshnessScore = 1
		} else {
			rep.FreshnessScore = 0.25
		}
	}
	return Recalculate(rep, event.At)
}

func Recalculate(rep DriverReputation, at time.Time) DriverReputation {
	rep.AcceptanceRate = rateOrNeutral(rep.AcceptedRides, rep.OfferedRides)
	rep.CompletionRate = rateOrNeutral(rep.CompletedRides, rep.AcceptedRides)
	rep.CancellationRate = rateOrZero(rep.CancelledRides, maxInt(1, rep.AcceptedRides+rep.CancelledRides))
	rep.CancelAfterAcceptRate = rep.CancellationRate

	if rep.FreshnessScore == 0 {
		rep.FreshnessScore = 0.5
	}
	rep.FreshnessScore = clamp01(rep.FreshnessScore)
	rep.ReliabilityScore = clamp01(0.70*rep.CompletionRate + 0.30*(1-rep.CancellationRate))
	rep.DispatchScore = CalculateDispatchScore(rep)
	if at.IsZero() {
		at = time.Now().UTC()
	}
	rep.UpdatedAt = at.UTC()
	return rep
}

func CalculateDispatchScore(rep DriverReputation) float64 {
	ratingScore := 0.5
	if rep.RatingCount > 0 {
		ratingScore = clamp01(rep.RatingAvg / 5)
	}
	completionScore := confidenceBlend(rep.CompletionRate, rep.AcceptedRides)
	acceptanceScore := confidenceBlend(rep.AcceptanceRate, rep.OfferedRides)
	reliabilityScore := clamp01(rep.ReliabilityScore)
	freshnessScore := clamp01(rep.FreshnessScore)
	cancellationPenalty := 0.15 * clamp01(rep.CancellationRate)

	score := 0.30*ratingScore +
		0.25*completionScore +
		0.20*acceptanceScore +
		0.15*reliabilityScore +
		0.10*freshnessScore -
		cancellationPenalty

	return round4(clamp01(score))
}

func rateOrNeutral(numerator int, denominator int) float64 {
	if denominator <= 0 {
		return 0.5
	}
	return clamp01(float64(numerator) / float64(denominator))
}

func rateOrZero(numerator int, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return clamp01(float64(numerator) / float64(denominator))
}

func confidenceBlend(observed float64, count int) float64 {
	confidence := math.Min(1, float64(count)/10)
	return clamp01((0.5 * (1 - confidence)) + (clamp01(observed) * confidence))
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]bool{}
	var result []string
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func timePtr(value time.Time) *time.Time {
	if value.IsZero() {
		value = time.Now().UTC()
	}
	utc := value.UTC()
	return &utc
}

func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func round4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
