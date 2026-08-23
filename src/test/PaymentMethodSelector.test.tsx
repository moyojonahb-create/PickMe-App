import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PaymentMethodSelector from "@/components/ride/PaymentMethodSelector";

describe("PaymentMethodSelector", () => {
  it("renders the payment sheet with cash and wallet rows", () => {
    render(
      <PaymentMethodSelector
        open
        onClose={vi.fn()}
        selected="cash"
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        walletBalance={12.5}
        estimatedFare={5}
      />
    );

    expect(screen.getByRole("radio", { name: /cash/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /pickme wallet/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Balance $12.50 · covers this trip")).toBeInTheDocument();
    expect(screen.getByText("Pay with cash")).toBeInTheDocument();
  });

  it("selects wallet when wallet has enough balance", () => {
    const onSelect = vi.fn();
    render(
      <PaymentMethodSelector
        open
        onClose={vi.fn()}
        selected="cash"
        onSelect={onSelect}
        onConfirm={vi.fn()}
        walletBalance={10}
        estimatedFare={6}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /pickme wallet/i }));
    expect(onSelect).toHaveBeenCalledWith("wallet");
  });

  it("disables wallet and shows the shortfall when balance is insufficient", () => {
    const onSelect = vi.fn();
    render(
      <PaymentMethodSelector
        open
        onClose={vi.fn()}
        selected="cash"
        onSelect={onSelect}
        onConfirm={vi.fn()}
        walletBalance={2}
        estimatedFare={6}
      />
    );

    const wallet = screen.getByRole("radio", { name: /pickme wallet/i });
    expect(wallet).toBeDisabled();
    expect(screen.getByText("Balance $2.00 · not enough for this trip")).toBeInTheDocument();

    fireEvent.click(wallet);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("names the chosen method on the confirm button", () => {
    render(
      <PaymentMethodSelector
        open
        onClose={vi.fn()}
        selected="wallet"
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        walletBalance={10}
        estimatedFare={5}
      />
    );

    expect(screen.getByText("Pay from wallet")).toBeInTheDocument();
  });

  it("calls onConfirm and onClose when confirm is tapped", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <PaymentMethodSelector
        open
        onClose={onClose}
        selected="cash"
        onSelect={vi.fn()}
        onConfirm={onConfirm}
        walletBalance={10}
        estimatedFare={5}
      />
    );

    fireEvent.click(screen.getByText("Pay with cash"));
    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("forces cash and disables wallet when restricted to cash", () => {
    const onSelect = vi.fn();
    render(
      <PaymentMethodSelector
        open
        onClose={vi.fn()}
        selected="cash"
        onSelect={onSelect}
        onConfirm={vi.fn()}
        walletBalance={50}
        estimatedFare={5}
        restrictToCash
        restrictReason="Ada pays cash on arrival — only cash works for a third-party ride"
      />
    );

    expect(screen.getByRole("radio", { name: /pickme wallet/i })).toBeDisabled();
    expect(screen.getByText(/Ada pays cash on arrival/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /pickme wallet/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <PaymentMethodSelector
        open={false}
        onClose={vi.fn()}
        selected="cash"
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
