# Background-location spike — protocol

The runnable app now lives in [`../mobile`](../mobile). This folder holds the
**protocol** only: [`RUNBOOK.md`](./RUNBOOK.md).

The harness source used to be duplicated here. It was deleted once `apps/mobile`
was scaffolded on SDK 57 — two copies of a test harness drift, and a spike whose
instrument disagrees with itself measures nothing.

- **Build + run instructions:** [`../mobile/README.md`](../mobile/README.md)
- **Scenarios, thresholds, pass/fail:** [`RUNBOOK.md`](./RUNBOOK.md)
