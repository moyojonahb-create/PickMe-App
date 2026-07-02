package notification

import "fmt"

type Template struct {
	Title string
	Body  string
}

func RenderTemplate(notificationType NotificationType, data TemplateData) Template {
	switch notificationType {
	case NotificationTypeRideOffer:
		return Template{Title: "New ride offer", Body: fmt.Sprintf("Pickup: %s. Dropoff: %s.", fallback(data.Pickup, "pickup point"), fallback(data.Dropoff, "destination"))}
	case NotificationTypeRideAccepted:
		return Template{Title: "Ride accepted", Body: fmt.Sprintf("%s accepted your ride.", fallback(data.DriverName, "Your driver"))}
	case NotificationTypeDriverArrived:
		return Template{Title: "Driver arrived", Body: fmt.Sprintf("%s has arrived at your pickup point.", fallback(data.DriverName, "Your driver"))}
	case NotificationTypeRideStarted:
		return Template{Title: "Ride started", Body: "Your PickMe ride has started."}
	case NotificationTypeRideCompleted:
		return Template{Title: "Ride completed", Body: "Your PickMe ride is complete. Thank you for riding with us."}
	case NotificationTypeWalletDepositApproved:
		return Template{Title: "Deposit approved", Body: fmt.Sprintf("Your %s %.2f wallet deposit was approved.", fallback(data.Currency, "USD"), data.Amount)}
	case NotificationTypeWithdrawalApproved:
		return Template{Title: "Withdrawal approved", Body: fmt.Sprintf("Your %s %.2f withdrawal was approved.", fallback(data.Currency, "USD"), data.Amount)}
	case NotificationTypeDriverVerification:
		return Template{Title: "Driver verification approved", Body: "Your driver verification has been approved."}
	case NotificationTypeStudentVerification:
		return Template{Title: "Student verification approved", Body: "Your student verification has been approved."}
	case NotificationTypeEmergencyAlert:
		return Template{Title: "Emergency alert", Body: fallback(data.Message, "An emergency alert needs attention.")}
	default:
		return Template{Title: "PickMe notification", Body: fallback(data.Message, "You have a new PickMe notification.")}
	}
}

func fallback(value string, replacement string) string {
	if value == "" {
		return replacement
	}
	return value
}
