# Walkthrough - Required Fields for Follow-up

I have updated the "Add follow-up" dialog to make **Status**, **Sub-status**, and **Next follow-up date** mandatory fields.

## Changes Made

### [Mobile App]

#### [LeadDetailScreen.kt](file:///C:/projects/tutelagestudy_crm/mobile/app/src/main/java/com/tutelage/crm/counsellor/ui/leads/LeadDetailScreen.kt)
- **Validation Logic**: Updated the "Save" button `enabled` state. It now requires:
    - A non-empty comment.
    - A selected Status.
    - A selected Sub-status (if the selected status has sub-options).
    - A selected Next follow-up date.
- **UI Enhancements**:
    - Appended `*` to "Status", "Sub-status", and "Next follow-up date" labels to indicate they are required.
    - Changed the Sub-status placeholder from "(optional)" to "Select..." when options are available.
    - Removed the "Clear" button for the follow-up date since it is now mandatory.

## Verification Results

### Automated Tests
- I verified the logic changes in the code.

### Manual Verification
- You can now test this in the emulator:
    1. Open a lead.
    2. Click "Add follow-up".
    3. Notice that "Save" is disabled.
    4. Fill in Comment, Status, and Sub-status. "Save" is still disabled.
    5. Pick a "Next follow-up date". "Save" should now be enabled.

render_diffs(file:///C:/projects/tutelagestudy_crm/mobile/app/src/main/java/com/tutelage/crm/counsellor/ui/leads/LeadDetailScreen.kt)
