# Security Specification - PicklePulse

## Data Invariants
1. **Tournament Integrity**: Every tournament must have a unique 6-character alphanumeric code. Only the `ownerId` can change the status or name.
2. **Match Lifecycle**: A match is created in `pending` status. Once `completed`, its score becomes immutable for regular users (only the `ownerId` can override).
3. **Identity Verification**: No user can set themselves as an `ownerId` of a tournament they didn't create.
4. **Member Scoping**: While "others can enter scores", they should only be able to update matches within tournaments that exist.

## The "Dirty Dozen" Payloads (Attack Vectors)

| ID | Attack Name | Target | Payload | Expected |
|---|---|---|---|---|
| 1 | Identity Spoofing | `/tournaments/{tId}` | `{"ownerId": "ANOTHER_USER_ID"}` (on create) | **DENIED** |
| 2 | Code Bypass | `/tournaments/{tId}` | `{"code": "SHORT"}` | **DENIED** |
| 3 | State Shortcut | `/tournaments/{tId}` | `{"status": "completed"}` (on create) | **DENIED** |
| 4 | Match Poisoning | `/tournaments/{tId}/matches/{mId}` | `{"team1": ["A"]}` (wrong size) | **DENIED** |
| 5 | Completed Override | `/tournaments/{tId}/matches/{mId}` | `{"score1": 100}` (on a status:completed match) | **DENIED** |
| 6 | Ghost Field Injection | `/tournaments/{tId}/players/{pId}` | `{"isAdmin": true}` | **DENIED** |
| 7 | Unverified Update | `/tournaments/{tId}/players/{pId}` | Updating `name` after creation | **DENIED** |
| 8 | Large Payload | `/tournaments/{tId}/players/{pId}` | `{"name": "A".repeat(200)}` | **DENIED** |
| 9 | Invalid ID | `/tournaments/!!!-INVALID-!!!` | Any operation | **DENIED** |
| 10 | Status Jumping | `/tournaments/{tId}` | `status: "invalid_state"` | **DENIED** |
| 11 | Score Fabrication | `/tournaments/{tId}/matches/{mId}` | `{"status": "completed"}` (without setting scores) | **DENIED** |
| 12 | Bulk Deletion | `/{document=**}` | recursive delete attempt | **DENIED** |

## Audit Report
Check `firestore.rules` for:
- [x] Global safety net (`match /{document=**} { allow read, write: if false; }`)
- [x] Auth check (`isSignedIn()`)
- [x] Static validation (`isValidTournament`, `isValidPlayer`, `isValidMatch`)
- [x] relantional check (`isOwner`)
- [x] Immutable fields (ownerId, code)
- [x] Status state machine (pending -> completed)
