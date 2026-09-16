# Make Status and Sub-status Required in "Add follow-up"

This plan outlines the changes to make the "Status" and "Sub-status" fields mandatory when adding a follow-up in the Android app.

## Proposed Changes

### [Mobile App]

#### [MODIFY] [LeadDetailScreen.kt](file:///C:/projects/tutelagestudy_crm/mobile/app/src/main/java/com/tutelage/crm/counsellor/ui/leads/LeadDetailScreen.kt)
- Update `AddFollowupDialog` to require `Status` and `Sub-status` (if sub-statuses are available) before the "Save" button becomes enabled.
- Add `*` to the labels of `Status` and `Sub-status` to indicate they are required.
- Update the placeholder for `Sub-status` from "(optional)" to "Select...".

## Proposed Steps

### 1. Research & Verification
- [x] Identify the relevant Composable (`AddFollowupDialog` in `LeadDetailScreen.kt`).
- [x] Understand the current validation logic for the "Save" button.

### 2. Implementation
- Modify `AddFollowupDialog` in `LeadDetailScreen.kt`:
    - Update `confirmButton` `enabled` condition.
    - Update `DropdownField` labels and placeholders.

### 3. Verification
- Build and run the app.
- Open the "Add follow-up" dialog.
- Verify that the "Save" button is disabled until "Comment", "Status", and "Sub-status" (if applicable) are filled.

## Verification Plan

### Manual Verification
1. Open the app and navigate to a Lead Detail screen.
2. Click on "Add follow-up".
3. Enter a comment. Observe that "Save" is still disabled.
4. Select a "Status".
5. If the status has sub-statuses, observe that "Save" is still disabled.
6. Select a "Sub-status". Observe that "Save" is now enabled.
7. Verify that if a status has NO sub-statuses, "Save" is enabled immediately after selecting the "Status".
