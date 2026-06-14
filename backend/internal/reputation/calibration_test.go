package reputation

import "testing"

func TestPercentileCalculations(t *testing.T) {
	result := CalculatePercentiles([]float64{0.1, 0.2, 0.3, 0.4, 0.5})
	if result.P50 != 0.3 || result.P90 != 0.46 || result.P95 != 0.48 {
		t.Fatalf("unexpected percentiles: %#v", result)
	}
}

func TestScoreDistribution(t *testing.T) {
	buckets := BuildScoreDistribution([]float64{0.05, 0.15, 0.95, 1.0}, 10)
	if buckets[0].Count != 1 || buckets[1].Count != 1 || buckets[9].Count != 2 {
		t.Fatalf("unexpected buckets: %#v", buckets)
	}
}

func TestCohortGeneration(t *testing.T) {
	cohorts := BuildCohorts([]DriverReputation{
		{DriverID: "new", CompletedRides: 0, DispatchScore: 0.5, AcceptanceRate: 0.5, CompletionRate: 0.5},
		{DriverID: "low", CompletedRides: 5, DispatchScore: 0.6, AcceptanceRate: 0.6, CompletionRate: 0.7},
		{DriverID: "medium", CompletedRides: 20, DispatchScore: 0.7, AcceptanceRate: 0.7, CompletionRate: 0.8},
		{DriverID: "high", CompletedRides: 60, DispatchScore: 0.8, AcceptanceRate: 0.8, CompletionRate: 0.9},
	})
	if cohorts["new"].DriverCount != 1 || cohorts["low_volume"].DriverCount != 1 || cohorts["medium_volume"].DriverCount != 1 || cohorts["high_volume"].DriverCount != 1 {
		t.Fatalf("unexpected cohorts: %#v", cohorts)
	}
}

func TestCalibrationCalculationsDetectRisk(t *testing.T) {
	health := AnalyzeCalibration([]DriverReputation{
		{DriverID: "new-1", CompletedRides: 0, DispatchScore: 0.40},
		{DriverID: "high-1", CompletedRides: 80, DispatchScore: 0.95},
		{DriverID: "high-2", CompletedRides: 90, DispatchScore: 0.96},
	})
	if !health.NewDriverDisadvantageDetected || !health.OverRewardedVeteransDetected {
		t.Fatalf("expected calibration risks, got %#v", health)
	}
	if health.DispatchIntegrationRecommendation != "not_ready" {
		t.Fatalf("expected not_ready recommendation, got %s", health.DispatchIntegrationRecommendation)
	}
}

func TestDispatchAnalysis(t *testing.T) {
	analysis := AnalyzeDispatchSimulation([]DispatchSimulationSample{
		{DriverID: "a", DispatchScore: 0.9, AcceptanceRate: 0.9, CompletionRate: 0.9, ActualDriverWasSelected: true, ActualDriverRank: 1},
		{DriverID: "b", DispatchScore: 0.5, AcceptanceRate: 0.5, CompletionRate: 0.6, ActualDriverWasSelected: false, ActualDriverRank: 4},
	})
	if analysis.ActualDriverWasSelectedRate != 0.5 || analysis.AverageActualDriverRank != 2.5 || analysis.SampleCount != 2 {
		t.Fatalf("unexpected dispatch analysis: %#v", analysis)
	}
	if analysis.ReputationAcceptanceCorrelation <= 0 {
		t.Fatalf("expected positive reputation/acceptance correlation, got %#v", analysis)
	}
}
