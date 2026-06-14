package reputation

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	rep   DriverReputation
	saves []DriverReputation
	err   error
}

func (f *fakeRepository) Get(ctx context.Context, driverID string) (DriverReputation, error) {
	if f.err != nil {
		return DriverReputation{}, f.err
	}
	if f.rep.DriverID == "" {
		return Neutral(driverID), nil
	}
	return f.rep, nil
}

func (f *fakeRepository) Save(ctx context.Context, before DriverReputation, after DriverReputation, event Event) error {
	if f.err != nil {
		return f.err
	}
	f.rep = after
	f.saves = append(f.saves, after)
	return nil
}

func TestNewDriverNeutralScore(t *testing.T) {
	rep := Neutral("driver-1")
	if rep.DispatchScore != 0.5 || rep.AcceptanceRate != 0.5 || rep.CompletionRate != 0.5 {
		t.Fatalf("expected neutral score, got %#v", rep)
	}
}

func TestScoreStaysBetweenZeroAndOne(t *testing.T) {
	rep := DriverReputation{
		DriverID:         "driver-1",
		RatingAvg:        10,
		RatingCount:      1,
		AcceptanceRate:   2,
		CompletionRate:   2,
		ReliabilityScore: 2,
		FreshnessScore:   2,
		CancellationRate: -1,
		AcceptedRides:    100,
		OfferedRides:     100,
	}
	score := CalculateDispatchScore(rep)
	if score < 0 || score > 1 {
		t.Fatalf("score must stay within [0,1], got %f", score)
	}
}

func TestCompletionImprovesScore(t *testing.T) {
	now := time.Now()
	rep := Neutral("driver-1")
	rep.OfferedRides = 10
	rep.AcceptedRides = 10
	before := Recalculate(rep, now).DispatchScore
	rep = ApplyEvent(rep, Event{DriverID: "driver-1", Type: EventRideCompleted, At: now})
	after := rep.DispatchScore
	if after <= before {
		t.Fatalf("expected completion to improve score, before=%f after=%f", before, after)
	}
}

func TestCancellationLowersScore(t *testing.T) {
	now := time.Now()
	rep := Neutral("driver-1")
	rep.OfferedRides = 10
	rep.AcceptedRides = 10
	rep.CompletedRides = 10
	before := Recalculate(rep, now).DispatchScore
	rep = ApplyEvent(rep, Event{DriverID: "driver-1", Type: EventRideCancelled, At: now})
	after := rep.DispatchScore
	if after >= before {
		t.Fatalf("expected cancellation to lower score, before=%f after=%f", before, after)
	}
}

func TestAcceptanceRateCalculation(t *testing.T) {
	rep := Neutral("driver-1")
	for i := 0; i < 4; i++ {
		rep = ApplyEvent(rep, Event{DriverID: "driver-1", Type: EventOfferSent, At: time.Now()})
	}
	for i := 0; i < 3; i++ {
		rep = ApplyEvent(rep, Event{DriverID: "driver-1", Type: EventOfferAccepted, At: time.Now()})
	}
	if rep.AcceptanceRate != 0.75 {
		t.Fatalf("expected acceptance rate 0.75, got %f", rep.AcceptanceRate)
	}
}

func TestLowRatingLowersScore(t *testing.T) {
	high := Neutral("driver-1")
	high.RatingAvg = 5
	high.RatingCount = 20
	high.OfferedRides = 10
	high.AcceptedRides = 10
	high.CompletedRides = 10
	high = Recalculate(high, time.Now())

	low := high
	low.RatingAvg = 2
	low = Recalculate(low, time.Now())

	if low.DispatchScore >= high.DispatchScore {
		t.Fatalf("expected low rating to lower score, high=%f low=%f", high.DispatchScore, low.DispatchScore)
	}
}

func TestReputationUpdateFailureDoesNotPanic(t *testing.T) {
	service := NewService(&fakeRepository{err: errors.New("db unavailable")})
	service.RecordOfferSubmitted(context.Background(), "driver-1", "ride-1", "offer-1")
	time.Sleep(20 * time.Millisecond)
}

func TestApplyEventPersistsUpdatedReputation(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(repo)
	_, err := service.ApplyEventSync(context.Background(), Event{
		DriverID: "driver-1",
		Type:     EventOfferSent,
		RideID:   "ride-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.saves) != 1 || repo.saves[0].OfferedRides != 1 {
		t.Fatalf("expected reputation save, got %#v", repo.saves)
	}
}
