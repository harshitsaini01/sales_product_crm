# Specification: Product Sales CRM

> **Document Version:** 3.0.0  
> **Status:** Implementation source of truth  
> **Product:** Single-company CRM for selling catalog products. Not admissions, not B2B quotes.

## Flow

1. Add a lead (name, email, mobile, status, owner). Extra fields stay Super Admin–defined.
2. Work the lead through statuses: **New → Contacted → Catalog Sent → Confirmed / Lost**.
3. Keep a simple product catalog: **photo, name, price, description**.
4. From the lead, pick products and send them by **email** or **WhatsApp**. Sending sets the lead to Catalog Sent.

There is no convert-to-company, quote, order, invoice, or delivery pipeline in this product.

## Always-on lead fields

name, email, mobile, lead type/status/sub-status, department, source, owner, followup date, trash, timestamps.

## Catalog send

Each send stores a snapshot of the products (name, price, photo, description) so later catalog edits do not rewrite history.
