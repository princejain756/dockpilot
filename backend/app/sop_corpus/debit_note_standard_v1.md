# Supplier Debit Note Reference Standard v1 (English)
Document ID: SOP-FIN-001
Revision: v1
Effective Date: 2026-09-01

## Clause 5: Draft Claim Generation for Short Deliveries
For approved short receipts where shortage pieces > 0, the commit transaction must emit a DRAFT Supplier Debit Note Pack containing taxable shortage value, split CGST/SGST (or IGST) calculation at the SKU tax rate, referenced invoice and e-Way Bill IDs, SOP clause citation, and approving supervisor ID. Final settlement remains in the separate Finance review queue.
