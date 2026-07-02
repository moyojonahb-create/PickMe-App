package rides

import (
	"encoding/json"
	"strconv"
	"strings"

	moneycore "pickme-backend/internal/money"
)

func (r *RideRequest) UnmarshalJSON(data []byte) error {
	type rideRequest RideRequest
	var aux struct {
		rideRequest
		EstimatedFare      json.RawMessage `json:"estimated_fare"`
		EstimatedFareMinor int64           `json:"estimated_fare_minor"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*r = RideRequest(aux.rideRequest)
	if len(aux.EstimatedFare) > 0 && string(aux.EstimatedFare) != "null" {
		amount, amountMinor, err := parseJSONMoneyUSD(aux.EstimatedFare)
		if err != nil {
			return err
		}
		r.EstimatedFare = amount
		r.EstimatedFareMinor = amountMinor
	}
	return nil
}

func (r RideRequest) MarshalJSON() ([]byte, error) {
	type rideRequest RideRequest
	aux := struct {
		rideRequest
		EstimatedFare float64 `json:"estimated_fare"`
	}{
		rideRequest:   rideRequest(r),
		EstimatedFare: r.EstimatedFare,
	}
	if aux.EstimatedFare == 0 && r.EstimatedFareMinor > 0 {
		aux.EstimatedFare = decimalUSDFromMinor(r.EstimatedFareMinor)
	}
	return json.Marshal(aux)
}

func (r *SubmitOfferRequest) UnmarshalJSON(data []byte) error {
	type submitOfferRequest SubmitOfferRequest
	var aux struct {
		submitOfferRequest
		Amount        json.RawMessage `json:"amount"`
		Price         json.RawMessage `json:"price"`
		OfferedFare   json.RawMessage `json:"offered_fare"`
		EstimatedFare json.RawMessage `json:"estimated_fare"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*r = SubmitOfferRequest(aux.submitOfferRequest)
	if len(aux.Amount) > 0 && string(aux.Amount) != "null" {
		amount, amountMinor, err := parseJSONMoneyUSD(aux.Amount)
		if err != nil {
			return err
		}
		r.Amount = amount
		r.AmountMinor = amountMinor
	}
	if len(aux.Price) > 0 && string(aux.Price) != "null" {
		amount, amountMinor, err := parseJSONMoneyUSD(aux.Price)
		if err != nil {
			return err
		}
		r.Price = amount
		r.PriceMinor = amountMinor
	}
	if len(aux.OfferedFare) > 0 && string(aux.OfferedFare) != "null" {
		amount, amountMinor, err := parseJSONMoneyUSD(aux.OfferedFare)
		if err != nil {
			return err
		}
		r.OfferedFare = amount
		r.OfferedFareMinor = amountMinor
	}
	if len(aux.EstimatedFare) > 0 && string(aux.EstimatedFare) != "null" {
		amount, amountMinor, err := parseJSONMoneyUSD(aux.EstimatedFare)
		if err != nil {
			return err
		}
		r.EstimatedFare = amount
		r.EstimatedFareMinor = amountMinor
	}
	return nil
}

func (r SubmitOfferRequest) MarshalJSON() ([]byte, error) {
	type submitOfferRequest SubmitOfferRequest
	aux := struct {
		submitOfferRequest
		Amount        float64 `json:"amount,omitempty"`
		Price         float64 `json:"price,omitempty"`
		OfferedFare   float64 `json:"offered_fare,omitempty"`
		EstimatedFare float64 `json:"estimated_fare,omitempty"`
	}{
		submitOfferRequest: submitOfferRequest(r),
		Amount:             r.Amount,
		Price:              r.Price,
		OfferedFare:        r.OfferedFare,
		EstimatedFare:      r.EstimatedFare,
	}
	if aux.Amount == 0 && r.AmountMinor > 0 {
		aux.Amount = decimalUSDFromMinor(r.AmountMinor)
	}
	if aux.Price == 0 && r.PriceMinor > 0 {
		aux.Price = decimalUSDFromMinor(r.PriceMinor)
	}
	if aux.OfferedFare == 0 && r.OfferedFareMinor > 0 {
		aux.OfferedFare = decimalUSDFromMinor(r.OfferedFareMinor)
	}
	if aux.EstimatedFare == 0 && r.EstimatedFareMinor > 0 {
		aux.EstimatedFare = decimalUSDFromMinor(r.EstimatedFareMinor)
	}
	return json.Marshal(aux)
}

func parseJSONMoneyUSD(raw json.RawMessage) (float64, int64, error) {
	text := strings.TrimSpace(string(raw))
	text = strings.Trim(text, `"`)
	amount, err := moneycore.ParseAmount(text, moneycore.CurrencyUSD)
	if err != nil {
		return 0, 0, err
	}
	decimal, err := strconv.ParseFloat(moneycore.FormatAmount(amount), 64)
	if err != nil {
		return 0, 0, err
	}
	return decimal, amount.AmountMinor, nil
}

func decimalUSDFromMinor(amountMinor int64) float64 {
	decimal, _ := strconv.ParseFloat(moneycore.FormatAmount(moneycore.Money{
		AmountMinor: amountMinor,
		Currency:    moneycore.CurrencyUSD,
	}), 64)
	return decimal
}
