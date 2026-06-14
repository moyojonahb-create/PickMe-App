package rides

import (
	"encoding/json"
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
	r.EstimatedFareMinor = aux.EstimatedFareMinor
	if len(aux.EstimatedFare) > 0 && string(aux.EstimatedFare) != "null" {
		amount, err := parseJSONMoneyMinor(aux.EstimatedFare)
		if err != nil {
			return err
		}
		r.EstimatedFareMinor = amount
	}
	return nil
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
		amount, err := parseJSONMoneyMinor(aux.Amount)
		if err != nil {
			return err
		}
		r.AmountMinor = amount
	}
	if len(aux.Price) > 0 && string(aux.Price) != "null" {
		amount, err := parseJSONMoneyMinor(aux.Price)
		if err != nil {
			return err
		}
		r.PriceMinor = amount
	}
	if len(aux.OfferedFare) > 0 && string(aux.OfferedFare) != "null" {
		amount, err := parseJSONMoneyMinor(aux.OfferedFare)
		if err != nil {
			return err
		}
		r.OfferedFareMinor = amount
	}
	if len(aux.EstimatedFare) > 0 && string(aux.EstimatedFare) != "null" {
		amount, err := parseJSONMoneyMinor(aux.EstimatedFare)
		if err != nil {
			return err
		}
		r.EstimatedFareMinor = amount
	}
	return nil
}

func parseJSONMoneyMinor(raw json.RawMessage) (int64, error) {
	text := strings.TrimSpace(string(raw))
	text = strings.Trim(text, `"`)
	amount, err := moneycore.ParseAmount(text, moneycore.CurrencyUSD)
	if err != nil {
		return 0, err
	}
	return amount.AmountMinor, nil
}
