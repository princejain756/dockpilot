"""Tax, TallyPrime XML, CGST Rule 53 PDF, Bilingual Gate-Pass, and HMAC sign-off artifacts."""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import datetime, timezone
from xml.sax.saxutils import escape as xml_escape

from fpdf import FPDF  # type: ignore

from app.models import PurchaseOrder, SKU, WorkflowSnapshot


def sign_approval_token(workflow_id: str, revision_id: int, secret: str) -> str:
    """Create a deterministic HMAC-SHA256 signature bound strictly to (workflow_id, revision_id)."""
    payload = f"approve:{workflow_id}:{revision_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()[:32]


def verify_approval_token(workflow_id: str, revision_id: int, token: str, secret: str) -> bool:
    """Verify HMAC token using constant-time comparison."""
    expected = sign_approval_token(workflow_id, revision_id, secret)
    return hmac.compare_digest(expected, (token or "").strip())


def sign_gate_pass_token(workflow_id: str, grn_id: str, secret: str) -> str:
    """Create HMAC-SHA256 verification digest for driver discrepancy gate-pass."""
    payload = f"gatepass:{workflow_id}:{grn_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()[:24]


def _paise(inr_float: float) -> int:
    return int(round(inr_float * 100))


def _ascii_safe(text: str) -> str:
    return re.sub(r"[^\x20-\x7E]", "-", str(text or ""))


def build_tally_debit_note_xml(snap: WorkflowSnapshot, po: PurchaseOrder, sku: SKU, company_name: str = "VayuMech Receiving Sandbox") -> str:
    """Generate TallyPrime-importable XML <ENVELOPE> (VCHTYPE='Debit Note') using integer-paise math."""
    claim = snap.claim_pack
    grn = snap.grn
    if claim is None or grn is None:
        raise ValueError("Cannot generate TallyPrime XML before GRN commit and claim creation.")

    taxable_inr = round(claim.taxable_shortage_inr, 2)
    cgst_inr = round(_paise(taxable_inr * (sku.gst_rate_pct / 200.0)) / 100.0, 2)
    sgst_inr = round(_paise(taxable_inr * (sku.gst_rate_pct / 200.0)) / 100.0, 2)
    total_inr = round(taxable_inr + cgst_inr + sgst_inr, 2)
    date_yyyymmdd = datetime.now(timezone.utc).strftime("%Y%m%d")

    erp_ref = grn.erp_receipt_id or grn.grn_id
    narration = (
        f"Shortage Debit Note for {po.po_number} / Inv {po.invoice_no} / "
        f"ERPNext {erp_ref} ({claim.short_pieces} pcs short, {claim.policy_clause}, "
        f"Approved by {claim.supervisor_id} on Rev {claim.revision_id})"
    )

    vch = xml_escape(claim.claim_id)
    vendor = xml_escape(po.vendor_name)
    comp = xml_escape(company_name)
    item = xml_escape(sku.name)
    narr = xml_escape(narration)
    inv_no = xml_escape(po.invoice_no)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{comp}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Debit Note" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>{date_yyyymmdd}</DATE>
            <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
            <VOUCHERNUMBER>{vch}</VOUCHERNUMBER>
            <REFERENCE>{inv_no}</REFERENCE>
            <PARTYLEDGERNAME>{vendor}</PARTYLEDGERNAME>
            <PARTYGSTIN>{xml_escape(po.vendor_gstin)}</PARTYGSTIN>
            <NARRATION>{narr}</NARRATION>
            <ISINVOICE>Yes</ISINVOICE>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{vendor}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-{total_inr:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>Purchase Returns - Shortage</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{taxable_inr:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>Input CGST {sku.gst_rate_pct // 2}% Reversal</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{cgst_inr:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>Input SGST {sku.gst_rate_pct // 2}% Reversal</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{sgst_inr:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>{item}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <RATE>{sku.unit_cost_inr:.2f}/Nos</RATE>
              <ACTUALQTY>{claim.short_pieces} Nos</ACTUALQTY>
              <BILLEDQTY>{claim.short_pieces} Nos</BILLEDQTY>
              <AMOUNT>{taxable_inr:.2f}</AMOUNT>
            </ALLINVENTORYENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""


def build_cgst_rule53_pdf(snap: WorkflowSnapshot, po: PurchaseOrder, sku: SKU, company_name: str = "VayuMech Receiving Sandbox") -> bytes:
    """Generate clean ASCII/Latin-1 CGST Rule 53 Shortage Debit Note PDF using fpdf2."""
    claim = snap.claim_pack
    grn = snap.grn
    if claim is None or grn is None:
        raise ValueError("Cannot generate CGST Rule 53 PDF before GRN commit and claim creation.")

    taxable = round(claim.taxable_shortage_inr, 2)
    half_rate = sku.gst_rate_pct / 200.0
    cgst = round(_paise(taxable * half_rate) / 100.0, 2)
    sgst = round(_paise(taxable * half_rate) / 100.0, 2)
    total = round(taxable + cgst + sgst, 2)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, "CGST RULE 53 SHORTAGE DEBIT NOTE (DRAFT)", ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, _ascii_safe(f"Issued by: {company_name} | Workflow: {snap.workflow_id} | Doc ID: {claim.claim_id}"), ln=True)
    pdf.ln(3)

    rows = [
        ("Supplier", f"{po.vendor_name} (GSTIN: {po.vendor_gstin})"),
        ("Original PO / Invoice", f"{po.po_number} / {po.invoice_no} (Challan: {po.challan_no})"),
        ("e-Way Bill", f"{po.eway_bill.eway_bill_no} ({po.eway_bill.status}) | Vehicle: {po.eway_bill.vehicle_no}"),
        ("GRN & ERPNext Record", f"{grn.grn_id} | ERPNext Purchase Receipt: {grn.erp_receipt_id or 'Pending'}"),
        ("Confirmed Count Revision", f"Revision {claim.revision_id} | Stock Balance After: {grn.erp_stock_after or snap.inventory_balance} pcs"),
        ("Supervisor Sign-Off", f"{claim.supervisor_id} | Policy Basis: {claim.policy_clause}"),
        ("SKU & HSN", f"{sku.sku_id} - {sku.name} (HSN {sku.hsn_code})"),
    ]
    for label, val in rows:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(48, 6, _ascii_safe(label), border=1)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, _ascii_safe(val), border=1, ln=True)

    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(90, 7, "Description", border=1)
    pdf.cell(25, 7, "Qty", border=1, align="R")
    pdf.cell(35, 7, "Rate (INR)", border=1, align="R")
    pdf.cell(0, 7, "Amount (INR)", border=1, align="R", ln=True)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(90, 7, _ascii_safe(f"Short delivery against {po.po_number} ({sku.sku_id})"), border=1)
    pdf.cell(25, 7, f"{claim.short_pieces} pcs", border=1, align="R")
    pdf.cell(35, 7, f"{sku.unit_cost_inr:,.2f}", border=1, align="R")
    pdf.cell(0, 7, f"{taxable:,.2f}", border=1, align="R", ln=True)

    for label, amt in [
        (f"CGST @ {sku.gst_rate_pct // 2}%", cgst),
        (f"SGST @ {sku.gst_rate_pct // 2}%", sgst),
        ("TOTAL DEBIT NOTE VALUE (INR)", total),
    ]:
        is_total = label.startswith("TOTAL")
        pdf.set_font("Helvetica", "B" if is_total else "", 9)
        pdf.cell(150, 7, _ascii_safe(label), border=1, align="R")
        pdf.cell(0, 7, f"INR {amt:,.2f}", border=1, align="R", ln=True)

    pdf.ln(5)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(
        0,
        4.5,
        _ascii_safe(
            "Clean-room operational debit-note draft generated atomically on DockPilot GRN commit. "
            "Verify GSTIN and portal IRN before statutory filing."
        ),
    )
    out = pdf.output()
    return bytes(out)


def build_driver_gate_pass(
    snap: WorkflowSnapshot,
    po: PurchaseOrder,
    sku: SKU,
    hmac_secret: str,
    public_web_url: str,
) -> dict[str, object]:
    """Construct bilingual Hindi/English Driver Discrepancy Gate-Pass payload."""
    grn = snap.grn
    if grn is None:
        raise ValueError("Gate pass is only generated after GRN commit.")
    sig = sign_gate_pass_token(snap.workflow_id, grn.grn_id, hmac_secret)
    gate_url = f"{public_web_url.rstrip('/')}/gate-pass/{snap.workflow_id}?sig={sig}"
    return {
        "gate_pass_id": f"GP-{grn.grn_id}",
        "workflow_id": snap.workflow_id,
        "grn_id": grn.grn_id,
        "erp_receipt_id": grn.erp_receipt_id,
        "po_number": po.po_number,
        "challan_no": po.challan_no,
        "vehicle_no": po.eway_bill.vehicle_no,
        "vendor_name": po.vendor_name,
        "sku_id": sku.sku_id,
        "sku_name": sku.name,
        "expected_pieces": po.expected_pieces,
        "received_pieces": grn.received_pieces,
        "shortage_pieces": grn.shortage_pieces,
        "shortage_value_inr": grn.shortage_value_inr,
        "title_hi": "ट्रक गेट पास और माल कम प्राप्ति रसीद (Discrepancy Gate Pass)",
        "summary_hi": (
            f"चालान {po.challan_no} ({po.eway_bill.vehicle_no}) पर {po.expected_pieces} पीस की जगह "
            f"{grn.received_pieces} पीस प्राप्त हुए। कुल कमी: {grn.shortage_pieces} पीस।"
        ),
        "summary_en": (
            f"Recorded {grn.received_pieces} of {po.expected_pieces} pcs on {po.challan_no} "
            f"(vehicle {po.eway_bill.vehicle_no}). Shortage {grn.shortage_pieces} pcs acknowledged before gate exit."
        ),
        "acknowledged_by_driver": False,
        "driver_name": None,
        "acknowledged_at": None,
        "sig": sig,
        "gate_url": gate_url,
    }
