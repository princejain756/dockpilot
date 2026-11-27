"""100% clean-room synthetic warehouse fixtures (20 SKUs, 10 POs/Challans)."""

from __future__ import annotations

from app.models import EWayBill, PurchaseOrder, SKU


def build_synthetic_skus() -> dict[str, SKU]:
    """Return 20 synthetic SKUs with explicit base-unit pack conversions."""
    items = [
        SKU(
            sku_id="SKU-24",
            name="Industrial Precision Valve Pack",
            unit_cost_inr=7000,
            gst_rate_pct=18,
            hsn_code="848180",
            pack_conversions={"peti": 24, "carton": 24, "box": 12, "piece": 1, "pcs": 1},
            ambiguous_units=[],
        ),
        SKU(
            sku_id="SKU-25",
            name="Hydraulic Flange Seal Kit",
            unit_cost_inr=2500,
            gst_rate_pct=18,
            hsn_code="401693",
            pack_conversions={"peti": 20, "carton": 20, "box": 10, "piece": 1},
            ambiguous_units=["box"],  # inner box=10 vs master carton=20
        ),
        SKU(
            sku_id="SKU-26",
            name="Stainless Bolt M12 Assembly",
            unit_cost_inr=450,
            gst_rate_pct=18,
            hsn_code="731815",
            pack_conversions={"peti": 50, "carton": 50, "dozen": 12, "piece": 1},
        ),
        SKU(
            sku_id="SKU-27",
            name="Pneumatic Pressure Regulator",
            unit_cost_inr=4200,
            gst_rate_pct=18,
            hsn_code="848110",
            pack_conversions={"peti": 12, "carton": 12, "piece": 1},
        ),
        SKU(
            sku_id="SKU-28",
            name="Heavy Duty Bearing 6205",
            unit_cost_inr=1200,
            gst_rate_pct=18,
            hsn_code="848210",
            pack_conversions={"peti": 40, "carton": 40, "box": 10, "piece": 1},
        ),
    ]
    for idx in range(29, 44):
        items.append(
            SKU(
                sku_id=f"SKU-{idx}",
                name=f"Synthetic Assembly Module {idx}",
                unit_cost_inr=1000 + (idx - 29) * 300,
                gst_rate_pct=18,
                hsn_code="848390",
                pack_conversions={"peti": 24, "carton": 24, "pack": 6, "piece": 1},
            )
        )
    return {item.sku_id: item for item in items}


def build_synthetic_pos() -> dict[str, PurchaseOrder]:
    """Return 10 synthetic POs covering canonical, expired e-Way Bill, and edge cases."""
    pos = [
        PurchaseOrder(
            po_number="PO-4471",
            vendor_id="VND-SYN-01",
            vendor_name="VayuMech Synthetic Components Pvt Ltd",
            vendor_gstin="29AABCV9999K1Z5",
            invoice_no="INV-4471",
            challan_no="CH-4471",
            eway_bill=EWayBill(
                eway_bill_no="EWB-2026-4471",
                valid_until_iso="2026-12-31T23:59:00+05:30",
                vehicle_no="KA01SYN4471",
                consignor_gstin="29AABCV9999K1Z5",
                declared_value_inr=2016000,
                status="ACTIVE",
            ),
            sku_id="SKU-24",
            ordered_cartons=12,
            pack_unit="peti",
            expected_pieces=288,
            open_pieces=288,
        ),
        PurchaseOrder(
            po_number="PO-4472",
            vendor_id="VND-SYN-02",
            vendor_name="Deccan Flow Controls Pvt Ltd",
            vendor_gstin="27AABCD8888M1ZT",
            invoice_no="INV-4472",
            challan_no="CH-4472",
            eway_bill=EWayBill(
                eway_bill_no="EWB-2026-4472",
                valid_until_iso="2026-11-01T18:00:00+05:30",
                vehicle_no="MH12SYN4472",
                consignor_gstin="27AABCD8888M1ZT",
                declared_value_inr=480000,
                status="EXPIRED",
            ),
            sku_id="SKU-26",
            ordered_cartons=10,
            pack_unit="peti",
            expected_pieces=500,
            open_pieces=500,
        ),
        PurchaseOrder(
            po_number="PO-4473",
            vendor_id="VND-SYN-03",
            vendor_name="Kaveri SealTech Pvt Ltd",
            vendor_gstin="33AABCK7777N1ZX",
            invoice_no="INV-4473",
            challan_no="CH-4473",
            eway_bill=EWayBill(
                eway_bill_no="EWB-2026-4473",
                valid_until_iso="2026-12-31T23:59:00+05:30",
                vehicle_no="TN09SYN4473",
                consignor_gstin="33AABCK7777N1ZX",
                declared_value_inr=250000,
                status="ACTIVE",
            ),
            sku_id="SKU-25",
            ordered_cartons=5,
            pack_unit="peti",
            expected_pieces=100,
            open_pieces=100,
        ),
        PurchaseOrder(
            po_number="PO-4474",
            vendor_id="VND-SYN-01",
            vendor_name="VayuMech Synthetic Components Pvt Ltd",
            vendor_gstin="29AABCV9999K1Z5",
            invoice_no="INV-4474",
            challan_no="CH-4474",
            eway_bill=EWayBill(
                eway_bill_no="EWB-2026-4474",
                valid_until_iso="2026-12-31T23:59:00+05:30",
                vehicle_no="KA05SYN4474",
                consignor_gstin="29AABCV9999K1Z5",
                declared_value_inr=504000,
                status="ACTIVE",
            ),
            sku_id="SKU-27",
            ordered_cartons=10,
            pack_unit="peti",
            expected_pieces=120,
            open_pieces=120,
        ),
    ]
    for idx in range(4475, 4481):
        sku_id = f"SKU-{24 + (idx - 4475) % 10}"
        pos.append(
            PurchaseOrder(
                po_number=f"PO-{idx}",
                vendor_id=f"VND-SYN-{idx - 4470:02d}",
                vendor_name=f"Synthetic Industrial Supplier {idx - 4470} Pvt Ltd",
                vendor_gstin=f"29AABCS{idx}K1Z1",
                invoice_no=f"INV-{idx}",
                challan_no=f"CH-{idx}",
                eway_bill=EWayBill(
                    eway_bill_no=f"EWB-2026-{idx}",
                    valid_until_iso="2026-12-31T23:59:00+05:30",
                    vehicle_no=f"KA01SYN{idx}",
                    consignor_gstin=f"29AABCS{idx}K1Z1",
                    declared_value_inr=300000,
                    status="ACTIVE",
                ),
                sku_id=sku_id,
                ordered_cartons=8,
                pack_unit="peti",
                expected_pieces=192,
                open_pieces=192,
            )
        )
    return {po.po_number: po for po in pos}


def build_initial_inventory(skus: dict[str, SKU]) -> dict[str, int]:
    """Return initial DOCK-1 warehouse balances anchored at 1,000 for SKU-24."""
    balances = {sku_id: 500 for sku_id in skus}
    balances["SKU-24"] = 1000
    return balances
