# Refresh the new-CRM database from the latest MySQL dump.
# Prerequisites: see docs/DATA_REFRESH.md
# Usage: from backend folder, run:
#   ./refresh-data.ps1 -MySQLPassword "<your-mysql-pwd>"
#
# This DOES NOT apply the reminder migration — do that via Supabase SQL Editor first.

param(
  [string]$DumpPath = "C:\office\crm.tutelagestudy.com\Database\latest_data_tutelagecrm.sql",
  [string]$MySQLUser = "root",
  [string]$MySQLPassword = "",
  [string]$LocalDB = "tutelage_crm",
  [switch]$SkipMySQLImport
)

$ErrorActionPreference = "Stop"

function Step($n, $msg) {
  Write-Host ""
  Write-Host "─── Step $n — $msg ───" -ForegroundColor Cyan
}

# Load DIRECT_URL from .env
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) { throw "Missing .env at $envFile" }
$directUrl = (Get-Content $envFile | Where-Object { $_ -match "^DIRECT_URL=" }) -replace "^DIRECT_URL=", ""
if (-not $directUrl) { throw "DIRECT_URL not set in .env" }

if (-not $SkipMySQLImport) {
  Step 1 "Import dump into local MySQL"
  if (-not (Test-Path $DumpPath)) { throw "Dump not found at $DumpPath" }

  $mysqlArgs = @("-u", $MySQLUser)
  if ($MySQLPassword) { $mysqlArgs += "-p$MySQLPassword" }

  & mysql @mysqlArgs -e "CREATE DATABASE IF NOT EXISTS $LocalDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  Get-Content $DumpPath | & mysql @mysqlArgs $LocalDB
}

Step 2 "Wipe Supabase data"
$env:WIPE_OK = "yes"
& npx tsx wipe-db.ts --confirm
if ($LASTEXITCODE -ne 0) { throw "wipe-db failed" }

Step 3 "Run pgloader (MySQL → Supabase)"
$mysqlPwdEnc = [uri]::EscapeDataString($MySQLPassword)
$mysqlUrl = "mysql://${MySQLUser}:${mysqlPwdEnc}@localhost:3306/$LocalDB"

$tmpLoad = Join-Path $env:TEMP "migrate-tutelage.load"
@"
LOAD DATABASE
  FROM   $mysqlUrl
  INTO   $directUrl
WITH
  data only,
  workers = 4,
  concurrency = 1,
  batch rows = 1000,
  batch size = 10MB
SET
  work_mem              TO '256MB',
  maintenance_work_mem  TO '512MB'
CAST
  type tinyint  to boolean  using tinyint-to-boolean,
  type bigint   to bigint,
  type int      to integer,
  type varchar  to text,
  type longtext to text,
  type mediumtext to text,
  type datetime  to timestamptz,
  type timestamp to timestamptz
EXCLUDING TABLES MATCHING 'tbl_uri|app_releases|email_campaigns|email_campaign_groups|email_campaign_recipients|inbound_mails|mobile_calls|device_tokens|_prisma_migrations'
;
"@ | Out-File -Encoding ascii $tmpLoad

& pgloader $tmpLoad
if ($LASTEXITCODE -ne 0) { throw "pgloader failed" }

Step 4 "Re-seed lead-flow"
& npx tsx fix-lead-flow.ts
& npx tsx cleanup-lead-types.ts

Write-Host ""
Write-Host "Done. Verify counts in Supabase SQL Editor:" -ForegroundColor Green
Write-Host "  SELECT COUNT(*) FROM leads;"
