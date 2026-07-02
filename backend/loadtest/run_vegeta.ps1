param(
  [int]$Rate = 100,
  [string]$Duration = "5m",
  [string]$Targets = ".\vegeta_targets.txt",
  [string]$Output = ".\vegeta-results.bin"
)

vegeta attack -rate $Rate -duration $Duration -targets $Targets -output $Output
vegeta report $Output
vegeta report -type json $Output
