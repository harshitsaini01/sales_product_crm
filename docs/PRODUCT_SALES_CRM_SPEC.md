# Specification: Dedicated Product Sales CRM

> **Document Version:** 2.0.0  
> **Status:** Implementation source of truth  
> **Product:** Single-vertical product + stock sales CRM (not education/admissions)

---

## Executive summary

This CRM sells physical (or catalog) products. It is **not** the counsellor/admissions product. A lead is an enquiry; an account is the buying company; a quote reserves stock; accepting a quote places an order, raises a GST invoice, and starts fulfillment (packed → out for delivery → delivered). Super Admin defines extra lead fields. Identity fields stay static.

## Static vs dynamic lead fields

**Always on:** name, email, mobile (+ alt), lead type/status/sub-status, department, source, campaign, followup date, owner, trash, timestamps, duplicates, lead score.

**Dynamic:** Super Admin schema builder (`CustomFieldDef`). Types: text, longtext, number, currency, select, multiselect, date, boolean, email, phone, url, **file**. Seed: company_name, gstin, designation, billing_address, shipping_address, delivery_date, po_number; files for PO, GST certificate, delivery slip.

Education groups (NEET, UCAT, SAT, father/mother, passport, university) are not seeded.

## Commercial loop

1. Enquiry (CRM / CSV / public catalog form / WhatsApp)
2. Cadence + SLA on first response
3. Catalog email/WhatsApp with live product cards (images resolved at send)
4. Quote with ATP + soft reserve (TTL). Public accept / decline / counter. Versions on revise.
5. Accept → order. Credit limit + floor-price approval. Hard stock dispatch. Auto GST invoice + delivery challan. `order_confirmed` mail with PDF.
6. Packed → out_for_delivery (tracking) → delivered (POD). Partial ship allowed. Public track link. Email + WhatsApp on each step.
7. Payments, dunning, optional UPI/payment link.
8. Returns: RMA, restock, credit note.
9. Account 360: LTV, health, replenish-due, next-best SKU.

ATP = on-hand − reserved. Movements: RESTOCK, TRANSFER, RESERVE, RELEASE, DISPATCH, RETURN, ADJUSTMENT, SAMPLE.

## Pricing and credit

Catalog price, quantity breaks, price lists (retail/dealer), account overrides. Discount below `minSellingPrice` requires manager approval. Account `creditLimit` + `creditDays`; block confirm if overdue and over limit unless override.

## Documents

- Quote = proforma  
- Tax invoice = HSN + CGST/SGST or IGST after order  
- Delivery challan for dispatch  
- Credit note on return  

Do not reuse Tutelage fee `Invoice`.

## Vertical

Single preset `product_sales`. Features on: leads, accounts, deals, sales_docs, custom_fields, campaigns, WhatsApp, dialer, tasks, location_tracking. Off: students, university_apps. Labels: counsellor → Sales Rep, student → Customer, course → Product.

## Out of v1

Courier booking APIs, Tally sync, manufacturing/serial-lot, logged-in customer portal, NIC e-invoice live API.
