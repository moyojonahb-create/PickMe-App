package wallet

import (
	"context"
	"errors"
	"testing"
)

type fakePilotRepo struct {
	user    PilotUser
	err     error
	changes []PilotUserChange
}

func (r *fakePilotRepo) GetPilotUser(ctx context.Context, userID string) (PilotUser, error) {
	if r.err != nil {
		return PilotUser{}, r.err
	}
	return r.user, nil
}

func (r *fakePilotRepo) SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error) {
	r.changes = append(r.changes, change)
	return PilotUser{UserID: change.UserID, Role: change.Role, Status: change.Status, GroupName: change.GroupName, Reason: change.Reason}, nil
}

func TestPilotEligibilityDisabledAllowsNormalBehavior(t *testing.T) {
	service := NewPilotService(&fakePilotRepo{err: errors.New("not configured")}, PilotConfig{Enabled: false})
	if !service.IsPilotEligible(context.Background(), "user-1", PilotRoleRider) {
		t.Fatal("disabled pilot must not block existing wallet behavior")
	}
}

func TestPilotEligibilityExplicitEnabledUser(t *testing.T) {
	service := NewPilotService(&fakePilotRepo{user: PilotUser{UserID: "user-1", Role: PilotRoleRider, Status: PilotStatusEnabled}}, PilotConfig{Enabled: true})
	if !service.IsPilotEligible(context.Background(), "user-1", PilotRoleRider) {
		t.Fatal("enabled pilot rider should be eligible")
	}
	if service.IsPilotEligible(context.Background(), "user-1", PilotRoleDriver) {
		t.Fatal("pilot rider should not be eligible for driver-only wallet operations")
	}
}

func TestPilotEligibilitySuspendedUserBlocked(t *testing.T) {
	service := NewPilotService(&fakePilotRepo{user: PilotUser{UserID: "user-1", Role: PilotRoleRider, Status: PilotStatusSuspended}}, PilotConfig{Enabled: true, Percentage: 100})
	if service.IsPilotEligible(context.Background(), "user-1", PilotRoleRider) {
		t.Fatal("suspended pilot user must be blocked even with percentage rollout")
	}
}

func TestPilotAdminRoleCanUsePilotWalletOperations(t *testing.T) {
	service := NewPilotService(&fakePilotRepo{user: PilotUser{UserID: "admin-1", Role: PilotRoleAdmin, Status: PilotStatusEnabled}}, PilotConfig{Enabled: true})
	if !service.IsPilotEligible(context.Background(), "admin-1", PilotRoleDriver) {
		t.Fatal("pilot admin should be eligible across pilot wallet roles")
	}
}

func TestPilotPercentageFallback(t *testing.T) {
	service := NewPilotService(&fakePilotRepo{err: errors.New("no explicit pilot row")}, PilotConfig{Enabled: true, Percentage: 100})
	if !service.IsPilotEligible(context.Background(), "user-1", PilotRoleRider) {
		t.Fatal("100 percent pilot percentage should allow unmatched users")
	}

	service = NewPilotService(&fakePilotRepo{err: errors.New("no explicit pilot row")}, PilotConfig{Enabled: true, Percentage: 0})
	if service.IsPilotEligible(context.Background(), "user-1", PilotRoleRider) {
		t.Fatal("0 percent pilot percentage should block unmatched users")
	}
}

func TestSetPilotUserDefaultsAndAuditsChange(t *testing.T) {
	repo := &fakePilotRepo{}
	service := NewPilotService(repo, PilotConfig{Enabled: true})
	user, err := service.SetPilotUser(context.Background(), PilotUserChange{UserID: "user-1", AdminID: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if user.Role != PilotRoleRider || user.Status != PilotStatusEnabled {
		t.Fatalf("expected default rider/enabled pilot user, got %#v", user)
	}
	if len(repo.changes) != 1 || repo.changes[0].AdminID != "admin-1" {
		t.Fatalf("expected audited pilot change, got %#v", repo.changes)
	}
}
