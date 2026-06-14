package reputation

import (
	"math"
	"sort"
)

type PercentileSet struct {
	Average float64 `json:"average"`
	P25     float64 `json:"p25"`
	P50     float64 `json:"p50"`
	P75     float64 `json:"p75"`
	P90     float64 `json:"p90"`
	P95     float64 `json:"p95"`
}

type ScoreBucket struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Count int     `json:"count"`
}

type CohortStats struct {
	Name                    string  `json:"name"`
	DriverCount             int     `json:"driver_count"`
	AverageDispatchScore    float64 `json:"average_dispatch_score"`
	AverageAcceptanceRate   float64 `json:"average_acceptance_rate"`
	AverageCompletionRate   float64 `json:"average_completion_rate"`
	AverageCancellationRate float64 `json:"average_cancellation_rate"`
	AverageScoreMovement    float64 `json:"average_score_movement"`
}

type CalibrationHealth struct {
	Percentiles                       PercentileSet `json:"percentiles"`
	ScoreInflationDetected            bool          `json:"score_inflation_detected"`
	ScoreCompressionDetected          bool          `json:"score_compression_detected"`
	ScoreStarvationDetected           bool          `json:"score_starvation_detected"`
	NewDriverDisadvantageDetected     bool          `json:"new_driver_disadvantage_detected"`
	OverRewardedVeteransDetected      bool          `json:"over_rewarded_veterans_detected"`
	AbnormalScoreClustering           bool          `json:"abnormal_score_clustering"`
	DispatchIntegrationRecommendation string        `json:"dispatch_integration_recommendation"`
}

type DispatchSimulationSample struct {
	DriverID                string
	DispatchScore           float64
	AcceptanceRate          float64
	CompletionRate          float64
	ActualDriverWasSelected bool
	ActualDriverRank        int
}

type DispatchAnalysis struct {
	ActualDriverWasSelectedRate     float64 `json:"actual_driver_was_selected_rate"`
	AverageActualDriverRank         float64 `json:"average_actual_driver_rank"`
	ReputationAcceptanceCorrelation float64 `json:"reputation_acceptance_correlation"`
	ReputationCompletionCorrelation float64 `json:"reputation_completion_correlation"`
	SampleCount                     int     `json:"sample_count"`
}

func CalculatePercentiles(values []float64) PercentileSet {
	if len(values) == 0 {
		return PercentileSet{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	var sum float64
	for _, value := range sorted {
		sum += value
	}
	return PercentileSet{
		Average: round4(sum / float64(len(sorted))),
		P25:     round4(percentile(sorted, 0.25)),
		P50:     round4(percentile(sorted, 0.50)),
		P75:     round4(percentile(sorted, 0.75)),
		P90:     round4(percentile(sorted, 0.90)),
		P95:     round4(percentile(sorted, 0.95)),
	}
}

func BuildScoreDistribution(values []float64, bucketCount int) []ScoreBucket {
	if bucketCount <= 0 {
		bucketCount = 10
	}
	buckets := make([]ScoreBucket, bucketCount)
	width := 1.0 / float64(bucketCount)
	for i := range buckets {
		buckets[i] = ScoreBucket{
			Start: round4(float64(i) * width),
			End:   round4(float64(i+1) * width),
		}
	}
	for _, value := range values {
		clamped := clamp01(value)
		index := int(clamped / width)
		if index >= bucketCount {
			index = bucketCount - 1
		}
		buckets[index].Count++
	}
	return buckets
}

func BuildCohorts(drivers []DriverReputation) map[string]CohortStats {
	cohorts := map[string]CohortStats{
		"new":           {Name: "new"},
		"low_volume":    {Name: "low_volume"},
		"medium_volume": {Name: "medium_volume"},
		"high_volume":   {Name: "high_volume"},
	}
	for _, driver := range drivers {
		key := cohortFor(driver.CompletedRides)
		cohort := cohorts[key]
		cohort.DriverCount++
		cohort.AverageDispatchScore += driver.DispatchScore
		cohort.AverageAcceptanceRate += driver.AcceptanceRate
		cohort.AverageCompletionRate += driver.CompletionRate
		cohort.AverageCancellationRate += driver.CancellationRate
		cohorts[key] = cohort
	}
	for key, cohort := range cohorts {
		if cohort.DriverCount > 0 {
			count := float64(cohort.DriverCount)
			cohort.AverageDispatchScore = round4(cohort.AverageDispatchScore / count)
			cohort.AverageAcceptanceRate = round4(cohort.AverageAcceptanceRate / count)
			cohort.AverageCompletionRate = round4(cohort.AverageCompletionRate / count)
			cohort.AverageCancellationRate = round4(cohort.AverageCancellationRate / count)
		}
		cohorts[key] = cohort
	}
	return cohorts
}

func AnalyzeCalibration(drivers []DriverReputation) CalibrationHealth {
	scores := make([]float64, 0, len(drivers))
	for _, driver := range drivers {
		scores = append(scores, driver.DispatchScore)
	}
	percentiles := CalculatePercentiles(scores)
	cohorts := BuildCohorts(drivers)
	newAvg := cohorts["new"].AverageDispatchScore
	highAvg := cohorts["high_volume"].AverageDispatchScore

	health := CalibrationHealth{
		Percentiles:                   percentiles,
		ScoreInflationDetected:        percentiles.P75 > 0.90,
		ScoreCompressionDetected:      percentiles.P75-percentiles.P25 < 0.10 && len(drivers) > 0,
		ScoreStarvationDetected:       percentiles.P50 < 0.35 && len(drivers) > 0,
		NewDriverDisadvantageDetected: cohorts["new"].DriverCount > 0 && cohorts["high_volume"].DriverCount > 0 && newAvg+0.10 < highAvg,
		OverRewardedVeteransDetected:  cohorts["high_volume"].DriverCount > 0 && highAvg > 0.90,
		AbnormalScoreClustering:       percentiles.P95-percentiles.P50 < 0.05 && len(drivers) > 0,
	}
	if health.ScoreInflationDetected || health.ScoreCompressionDetected || health.ScoreStarvationDetected || health.NewDriverDisadvantageDetected || health.OverRewardedVeteransDetected || health.AbnormalScoreClustering {
		health.DispatchIntegrationRecommendation = "not_ready"
	} else {
		health.DispatchIntegrationRecommendation = "observe_more"
	}
	return health
}

func AnalyzeDispatchSimulation(samples []DispatchSimulationSample) DispatchAnalysis {
	if len(samples) == 0 {
		return DispatchAnalysis{}
	}
	var selected float64
	var rankSum float64
	var rankCount float64
	var scores []float64
	var acceptance []float64
	var completion []float64
	for _, sample := range samples {
		if sample.ActualDriverWasSelected {
			selected++
		}
		if sample.ActualDriverRank > 0 {
			rankSum += float64(sample.ActualDriverRank)
			rankCount++
		}
		scores = append(scores, sample.DispatchScore)
		acceptance = append(acceptance, sample.AcceptanceRate)
		completion = append(completion, sample.CompletionRate)
	}
	averageRank := 0.0
	if rankCount > 0 {
		averageRank = rankSum / rankCount
	}
	return DispatchAnalysis{
		ActualDriverWasSelectedRate:     round4(selected / float64(len(samples))),
		AverageActualDriverRank:         round4(averageRank),
		ReputationAcceptanceCorrelation: round4(correlation(scores, acceptance)),
		ReputationCompletionCorrelation: round4(correlation(scores, completion)),
		SampleCount:                     len(samples),
	}
}

func cohortFor(completedRides int) string {
	switch {
	case completedRides == 0:
		return "new"
	case completedRides < 10:
		return "low_volume"
	case completedRides < 50:
		return "medium_volume"
	default:
		return "high_volume"
	}
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	if len(sorted) == 1 {
		return sorted[0]
	}
	position := p * float64(len(sorted)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
}

func correlation(x []float64, y []float64) float64 {
	if len(x) == 0 || len(x) != len(y) {
		return 0
	}
	var sumX, sumY float64
	for i := range x {
		sumX += x[i]
		sumY += y[i]
	}
	meanX := sumX / float64(len(x))
	meanY := sumY / float64(len(y))
	var numerator, denominatorX, denominatorY float64
	for i := range x {
		dx := x[i] - meanX
		dy := y[i] - meanY
		numerator += dx * dy
		denominatorX += dx * dx
		denominatorY += dy * dy
	}
	denominator := math.Sqrt(denominatorX * denominatorY)
	if denominator == 0 {
		return 0
	}
	return numerator / denominator
}
