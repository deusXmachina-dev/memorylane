/**
 * Synthetic PII eval fixture (DEU-205). Planted values are fictional or public
 * test data (555-01xx phones, test card numbers, AWS docs keys). Every `pii`
 * string must be gone from a scrubber's output; every control must survive
 * unchanged. Secret-shaped strings are concatenated so push protection and
 * secret scanners don't flag the repo.
 */

export type PiiCategory =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'ssn'
  | 'dob'
  | 'credit_card'
  | 'bank'
  | 'employee_id'
  | 'username'
  | 'password'
  | 'secret'
  | 'tfn'
  | 'medicare'
  | 'ird'
  | 'nhi'

/**
 * Categories the policy deliberately preserves. A plant in one of these must
 * survive verbatim — names, emails and handles are the client-vs-internal
 * signal that makes a sighting legible, so removing them is a defect, not a
 * success. Usernames are credential material only on a login screen, and those
 * are already excluded upstream by the capture gate.
 */
export const KEEP_CATEGORIES = new Set<PiiCategory>(['name', 'email', 'username'])

/**
 * Categories no deterministic rule can reach. Street addresses cannot be
 * matched without also destroying every "Payables > Acme Corp" path. Reported
 * as known gaps rather than scored as failures.
 */
export const GAP_CATEGORIES = new Set<PiiCategory>(['address'])

export type TextShape = 'window_title' | 'summary' | 'ocr'

export interface PiiPlant {
  id: string
  category: PiiCategory
  shape: TextShape
  text: string
  pii: string
}

export interface CleanControl {
  id: string
  kind: string
  text: string
}

const OPENAI_KEY = 'sk-' + 'proj-Ab3dEfGh1jKlMnOpQrStUvWxYz0123456789AbCd'
const GH_TOKEN = 'ghp_' + 'x7Q9rT2mNv4bL8cJ5wY1zA3eD6fH0iKwPqRs'
const GH_PAT = 'github_pat_' + '11AABBCCD0x9Y8z7W6v5U4t3S2r1Q0pOnMlKjIhGfEdCbA98765'
const AWS_KEY_ID = 'AKIA' + 'IOSFODNN7EXAMPLE'
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY'
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

function plant(
  id: string,
  category: PiiCategory,
  shape: TextShape,
  text: string,
  pii: string,
): PiiPlant {
  return { id, category, shape, text, pii }
}

export const PII_PLANTS: PiiPlant[] = [
  plant(
    'name-01',
    'name',
    'window_title',
    '1:1 with Marcus Delgado - Google Meet',
    'Marcus Delgado',
  ),
  plant(
    'name-02',
    'name',
    'window_title',
    'Re: Offer letter — Angela Whitfield - Outlook',
    'Angela Whitfield',
  ),
  plant(
    'name-03',
    'name',
    'window_title',
    'Patient: Dorothy Simmons | Chart Review - Epic',
    'Dorothy Simmons',
  ),
  plant(
    'name-04',
    'name',
    'summary',
    'Drafted a performance review for Samuel Adeyemi in Workday, focusing on Q2 goals and peer feedback.',
    'Samuel Adeyemi',
  ),
  plant(
    'name-05',
    'name',
    'ocr',
    'Candidate Name: Priya Raghunathan\nPosition: Senior Analyst\nStage: Onsite',
    'Priya Raghunathan',
  ),
  plant('name-06', 'name', 'window_title', 'Slack | DM with Grace Liu', 'Grace Liu'),
  plant(
    'name-07',
    'name',
    'window_title',
    'Tamara Jenkins-Cole — LinkedIn Profile',
    'Tamara Jenkins-Cole',
  ),
  plant(
    'name-08',
    'name',
    'summary',
    'Called Luis Fernando Ortega about the Q3 renewal and updated the opportunity stage in Salesforce.',
    'Luis Fernando Ortega',
  ),
  plant(
    'name-09',
    'name',
    'summary',
    "Worked through Rachel Goldberg's onboarding checklist in Asana and assigned the IT provisioning subtasks.",
    'Rachel Goldberg',
  ),
  plant(
    'name-10',
    'name',
    'ocr',
    'Interviewer: Kevin O’Brien\nPanel: Engineering\nRoom: 4B',
    'Kevin O’Brien',
  ),
  plant(
    'name-11',
    'name',
    'ocr',
    'Approved by: Whitney Castellanos\nDate: pending\nDepartment: Finance',
    'Whitney Castellanos',
  ),
  plant(
    'name-12',
    'name',
    'summary',
    'Reviewed the escalation from Deshawn Mitchell about a delayed refund and drafted a response in Zendesk.',
    'Deshawn Mitchell',
  ),

  plant(
    'email-01',
    'email',
    'window_title',
    'Inbox (14) - rgoldberg@corporatemail.com - Outlook',
    'rgoldberg@corporatemail.com',
  ),
  plant(
    'email-02',
    'email',
    'summary',
    'Sent the revised contract to angela.whitfield@gmail.com and CCed the legal alias.',
    'angela.whitfield@gmail.com',
  ),
  plant(
    'email-03',
    'email',
    'ocr',
    'From: marcus.delgado1987@yahoo.com\nSubject: Re: invoice dispute',
    'marcus.delgado1987@yahoo.com',
  ),
  plant(
    'email-04',
    'email',
    'ocr',
    'Contact\nEmail: d.simmons@outlook.com\nPreferred: email',
    'd.simmons@outlook.com',
  ),
  plant(
    'email-05',
    'email',
    'summary',
    'Forwarded the benefits enrollment form to priya.r@acmehealth.org for signature.',
    'priya.r@acmehealth.org',
  ),
  plant(
    'email-06',
    'email',
    'window_title',
    'Compose: kevin.obrien@umich.edu - Gmail',
    'kevin.obrien@umich.edu',
  ),
  plant(
    'email-07',
    'email',
    'ocr',
    'Login\nEmail address\ntgreene91@protonmail.com\nContinue',
    'tgreene91@protonmail.com',
  ),
  plant(
    'email-08',
    'email',
    'summary',
    'Added grace.liu+vendor@fastmail.com to the supplier contact list in NetSuite.',
    'grace.liu+vendor@fastmail.com',
  ),
  plant(
    'email-09',
    'email',
    'ocr',
    'Reply-To: luis.ortega@sunbeltlogistics.com\nSent: Monday 9:14 AM',
    'luis.ortega@sunbeltlogistics.com',
  ),
  plant(
    'email-10',
    'email',
    'window_title',
    'Password reset for dwhite.home@icloud.com - Mail',
    'dwhite.home@icloud.com',
  ),

  plant(
    'phone-01',
    'phone',
    'summary',
    'Called the client back at (415) 555-0173 to confirm the delivery window.',
    '(415) 555-0173',
  ),
  plant(
    'phone-02',
    'phone',
    'ocr',
    'Customer callback\nPhone: 415-555-0198\nPriority: high',
    '415-555-0198',
  ),
  plant('phone-03', 'phone', 'ocr', 'Mobile: 415.555.0142\nWork: n/a', '415.555.0142'),
  plant(
    'phone-04',
    'phone',
    'summary',
    'Texted +1 (202) 555-0161 about rescheduling the site visit.',
    '+1 (202) 555-0161',
  ),
  plant(
    'phone-05',
    'phone',
    'ocr',
    'Emergency contact\n202-555-0117\nRelation: spouse',
    '202-555-0117',
  ),
  plant('phone-06', 'phone', 'ocr', 'Tel 6505550109\nFax none', '6505550109'),
  plant(
    'phone-07',
    'phone',
    'summary',
    'Left a voicemail at +1 650 555 0129 regarding the overdue invoice.',
    '+1 650 555 0129',
  ),
  plant(
    'phone-08',
    'phone',
    'window_title',
    'Missed call from (312) 555-0186 - Teams',
    '(312) 555-0186',
  ),
  plant(
    'phone-09',
    'phone',
    'ocr',
    'Verify your number\nWe sent a code to 917-555-0134',
    '917-555-0134',
  ),
  plant(
    'phone-10',
    'phone',
    'summary',
    'Updated the CRM record with the new direct line 646 555 0151 for the buyer.',
    '646 555 0151',
  ),

  plant(
    'addr-01',
    'address',
    'ocr',
    'Ship to:\n1847 Maplewood Ave\nColumbus, OH 43215',
    '1847 Maplewood Ave',
  ),
  plant(
    'addr-02',
    'address',
    'summary',
    'Updated the delivery address to 742 Evergreen Terrace, Springfield, IL 62704 in the order system.',
    '742 Evergreen Terrace',
  ),
  plant(
    'addr-03',
    'address',
    'ocr',
    'Billing address\n98 Bleecker St Apt 4B\nNew York, NY 10012',
    '98 Bleecker St Apt 4B',
  ),
  plant(
    'addr-04',
    'address',
    'summary',
    'Scheduled the inspection at 5501 Rosewood Drive, Plano, TX 75024 for Thursday morning.',
    '5501 Rosewood Drive',
  ),
  plant('addr-05', 'address', 'ocr', 'Mailing: PO Box 1123, Reno, NV 89501', 'PO Box 1123'),
  plant(
    'addr-06',
    'address',
    'summary',
    'Booked the client meeting at 330 W 42nd St, 15th floor, and sent calendar invites.',
    '330 W 42nd St',
  ),
  plant(
    'addr-07',
    'address',
    'ocr',
    'Deliver to: 2214 Harborview Ln, Tampa, FL 33602\nLeave at door',
    '2214 Harborview Ln',
  ),
  plant(
    'addr-08',
    'address',
    'ocr',
    'Home address\n6 Birchwood Ct\nBellevue, WA 98004',
    '6 Birchwood Ct',
  ),
  plant(
    'addr-09',
    'address',
    'summary',
    'Corrected the W-2 mailing address to 1930 Alder Grove Blvd, Sacramento, CA 95815.',
    '1930 Alder Grove Blvd',
  ),
  plant(
    'addr-10',
    'address',
    'window_title',
    '4406 Sunnybrook Rd, Austin, TX 78745 - Zillow',
    '4406 Sunnybrook Rd',
  ),

  plant(
    'ssn-01',
    'ssn',
    'ocr',
    'Applicant SSN: 416-72-8395\nStatus: pending verification',
    '416-72-8395',
  ),
  plant('ssn-02', 'ssn', 'ocr', 'Social Security Number\n545-86-2194\nConfirm', '545-86-2194'),
  plant(
    'ssn-03',
    'ssn',
    'summary',
    'Entered the SSN 217-40-9068 into the payroll onboarding form for the new hire.',
    '217-40-9068',
  ),
  plant('ssn-04', 'ssn', 'ocr', 'SSN: 078-05-1120\nDOB: on file', '078-05-1120'),
  plant('ssn-05', 'ssn', 'ocr', 'Taxpayer ID (SSN) 362518377', '362518377'),
  plant(
    'ssn-06',
    'ssn',
    'summary',
    'Verified the last four of the SSN 545862194 against the benefits record.',
    '545862194',
  ),
  plant('ssn-07', 'ssn', 'ocr', 'SSN 416 72 8395\nSignature required', '416 72 8395'),
  plant('ssn-08', 'ssn', 'window_title', 'W-9 Form - SSN 217-40-9068 - Preview', '217-40-9068'),

  plant('dob-01', 'dob', 'ocr', 'Date of Birth: 03/14/1987\nGender: F', '03/14/1987'),
  plant('dob-02', 'dob', 'ocr', 'DOB\n1987-03-14\nMember since 2019', '1987-03-14'),
  plant(
    'dob-03',
    'dob',
    'summary',
    'Corrected the patient date of birth to June 12, 1979 in the intake record.',
    'June 12, 1979',
  ),
  plant('dob-04', 'dob', 'ocr', 'Born: 11/02/1962\nPlace: Ohio', '11/02/1962'),
  plant(
    'dob-05',
    'dob',
    'summary',
    'Confirmed the dependent DOB 07/04/1991 while updating the insurance enrollment.',
    '07/04/1991',
  ),
  plant(
    'dob-06',
    'dob',
    'ocr',
    'Passenger details\nDate of birth 09/23/1975\nSeat 14C',
    '09/23/1975',
  ),

  plant(
    'cc-01',
    'credit_card',
    'ocr',
    'Card number\n4111 1111 1111 1111\nExp 09/28',
    '4111 1111 1111 1111',
  ),
  plant(
    'cc-02',
    'credit_card',
    'ocr',
    'Payment method\n4012888888881881\nVisa',
    '4012888888881881',
  ),
  plant(
    'cc-03',
    'credit_card',
    'ocr',
    'Card: 5555-5555-5555-4444\nCVV: ***',
    '5555-5555-5555-4444',
  ),
  plant(
    'cc-04',
    'credit_card',
    'summary',
    'Charged the deposit to the card 5105105105105100 after confirming the amount with the guest.',
    '5105105105105100',
  ),
  plant('cc-05', 'credit_card', 'ocr', 'AMEX ending\n378282246310005', '378282246310005'),
  plant(
    'cc-06',
    'credit_card',
    'ocr',
    'Corporate Amex\n3714 496353 98431\nActive',
    '3714 496353 98431',
  ),
  plant('cc-07', 'credit_card', 'ocr', 'Discover 6011111111111117\nAutopay on', '6011111111111117'),
  plant(
    'cc-08',
    'credit_card',
    'summary',
    'Updated the card on file to 6011 0009 9013 9424 for the recurring subscription.',
    '6011 0009 9013 9424',
  ),
  plant('cc-09', 'credit_card', 'ocr', 'Visa 4222222222222\nExpired', '4222222222222'),
  plant(
    'cc-10',
    'credit_card',
    'window_title',
    'Refund card 5200 8282 8282 8210 - Stripe Dashboard',
    '5200 8282 8282 8210',
  ),

  plant('bank-01', 'bank', 'ocr', 'Routing number: 021000021\nAccount type: checking', '021000021'),
  plant('bank-02', 'bank', 'ocr', 'ABA 026009593\nWire instructions', '026009593'),
  plant(
    'bank-03',
    'bank',
    'summary',
    'Set up direct deposit with routing 121000358 and confirmed the first payment date.',
    '121000358',
  ),
  plant('bank-04', 'bank', 'ocr', 'Routing: 121042882\nAccount: on file', '121042882'),
  plant('bank-05', 'bank', 'ocr', 'Account number\n4830112957\nSavings', '4830112957'),
  plant(
    'bank-06',
    'bank',
    'summary',
    'Entered the beneficiary account number 00812734655 for the vendor payout.',
    '00812734655',
  ),
  plant(
    'bank-07',
    'bank',
    'ocr',
    'IBAN GB82WEST12345698765432\nSWIFT on request',
    'GB82WEST12345698765432',
  ),

  plant('emp-01', 'employee_id', 'ocr', 'Employee ID: EMP-04481\nDepartment: Ops', 'EMP-04481'),
  plant('emp-02', 'employee_id', 'ocr', 'Badge #88213\nAccess level 2', '88213'),
  plant(
    'emp-03',
    'employee_id',
    'summary',
    'Looked up employee ID 7734902 in Workday to correct the cost center assignment.',
    '7734902',
  ),
  plant('emp-04', 'employee_id', 'ocr', 'Emp No. E-118245\nShift: night', 'E-118245'),
  plant('emp-05', 'employee_id', 'ocr', 'Worker ID 00482913\nContractor', '00482913'),
  plant('emp-06', 'employee_id', 'window_title', 'Timesheet — EMP-04481 - ADP', 'EMP-04481'),

  plant('user-01', 'username', 'ocr', 'Username: jsmith84\nRemember me', 'jsmith84'),
  plant('user-02', 'username', 'ocr', 'Login\nmrivera22\nForgot username?', 'mrivera22'),
  plant(
    'user-03',
    'username',
    'summary',
    'Reset the account for the username dwhite_admin after the lockout was reported.',
    'dwhite_admin',
  ),
  plant('user-04', 'username', 'ocr', 'Signed in as tgreene91', 'tgreene91'),
  plant(
    'user-05',
    'username',
    'summary',
    'Granted repo access to the user kpatel-dev and confirmed the invitation was accepted.',
    'kpatel-dev',
  ),
  plant('user-06', 'username', 'ocr', 'User ID\ncjohnson_ops\nNext', 'cjohnson_ops'),

  plant('pass-01', 'password', 'ocr', 'Password: Tr0ub4dor&3\nSign in', 'Tr0ub4dor&3'),
  plant(
    'pass-02',
    'password',
    'ocr',
    'Temporary password\nSumm3r!2026\nChange on first login',
    'Summ3r!2026',
  ),
  plant('pass-03', 'password', 'ocr', 'pass: hunter2!\nlogin: admin', 'hunter2!'),
  plant(
    'pass-04',
    'password',
    'summary',
    'Shared the temporary password P@ssw0rd123 with the contractor over Slack before the rotation.',
    'P@ssw0rd123',
  ),
  plant('pass-05', 'password', 'ocr', 'Wi-Fi password: Xk9#mQ2$vL', 'Xk9#mQ2$vL'),
  plant(
    'pass-06',
    'password',
    'ocr',
    'New password\nBlueHorizon#77\nConfirm password\nBlueHorizon#77',
    'BlueHorizon#77',
  ),

  plant('secret-01', 'secret', 'ocr', `OPENAI_API_KEY=${OPENAI_KEY}`, OPENAI_KEY),
  plant('secret-02', 'secret', 'ocr', `export GITHUB_TOKEN=${GH_TOKEN}`, GH_TOKEN),
  plant(
    'secret-03',
    'secret',
    'summary',
    `Rotated the fine-grained token ${GH_PAT} in the deploy workflow secrets.`,
    GH_PAT,
  ),
  plant(
    'secret-04',
    'secret',
    'ocr',
    `aws_access_key_id = ${AWS_KEY_ID}\nregion = us-east-1`,
    AWS_KEY_ID,
  ),
  plant('secret-05', 'secret', 'ocr', `aws_secret_access_key = ${AWS_SECRET}`, AWS_SECRET),
  plant('secret-06', 'secret', 'ocr', `Authorization: Bearer ${JWT}`, JWT),
  plant(
    'secret-07',
    'secret',
    'summary',
    `Pasted the API key ${OPENAI_KEY} into the staging environment config during the integration test.`,
    OPENAI_KEY,
  ),
  plant(
    'secret-08',
    'secret',
    'window_title',
    `${GH_TOKEN} - Search results - 1Password`,
    GH_TOKEN,
  ),

  plant('tfn-01', 'tfn', 'ocr', 'Tax file number 123 456 782\nStatus: verified', '123 456 782'),
  plant(
    'tfn-02',
    'tfn',
    'summary',
    'Entered the TFN 123456782 into the onboarding form.',
    '123456782',
  ),
  plant('tfn-03', 'tfn', 'window_title', 'TFN declaration 876 543 210 - myGov', '876 543 210'),
  plant('medicare-01', 'medicare', 'ocr', 'Medicare 2123 45670 1\nExpiry 09/29', '2123 45670 1'),
  plant(
    'medicare-02',
    'medicare',
    'summary',
    'Copied the Medicare number 2428 77813 2 from the scanned card into the claim.',
    '2428 77813 2',
  ),
  plant(
    'medicare-03',
    'medicare',
    'ocr',
    'Card shows 2123 45670 1 for the dependant',
    '2123 45670 1',
  ),
  plant('ird-01', 'ird', 'ocr', 'IRD number 49-091-850\nTax code M', '49-091-850'),
  plant(
    'ird-02',
    'ird',
    'summary',
    'Filed the GST return against 136-410-132 for the March period.',
    '136-410-132',
  ),
  plant('ird-03', 'ird', 'window_title', 'IRD 49091850 - myIR', '49091850'),
  plant('nhi-01', 'nhi', 'ocr', 'NHI ZAC5361\nGP: Northcote Medical', 'ZAC5361'),
  plant(
    'nhi-02',
    'nhi',
    'summary',
    'Looked up the patient by NHI ZZZ0016 before booking the referral.',
    'ZZZ0016',
  ),
  plant('bank-08', 'bank', 'ocr', 'BSB 062-000\nAccount 12345678\nName: N Williams', '12345678'),
  plant(
    'bank-09',
    'bank',
    'summary',
    'Set up the supplier payment to 01-0123-0123456-00 in the banking portal.',
    '01-0123-0123456-00',
  ),
  plant('phone-11', 'phone', 'ocr', 'Mobile: 0412 987 654\nAfter hours only', '0412 987 654'),
  plant(
    'phone-12',
    'phone',
    'summary',
    'Rang the depot on +64 21 555 0134 to confirm the pallet count.',
    '+64 21 555 0134',
  ),
]

function control(id: string, kind: string, text: string): CleanControl {
  return { id, kind, text }
}

export const CLEAN_CONTROLS: CleanControl[] = [
  control('date-01', 'date', 'Sprint review 07/24/2026 - Calendar'),
  control('date-02', 'date', 'Deadline moved to 12/31/2026 per the revised SOW.'),
  control('date-03', 'date', '2026-07-27 standup notes - Notion'),
  control('date-04', 'date', 'Compared the 2024-2025 archive against the current fiscal year.'),
  control('date-05', 'date', 'Q3 2026 roadmap draft - Google Slides'),
  control('money-01', 'money', 'Budget approved at $250,000 for the pilot rollout.'),
  control('money-02', 'money', 'Revenue target $1,000,000 ARR - Board deck'),
  control('money-03', 'money', 'Processed 1,250,000 rows in the nightly ETL job.'),
  control('money-04', 'money', 'Invoice total 84 250 USD after the volume discount.'),
  control('version-01', 'version', 'v1.5.4-alpha.1 release notes - GitHub'),
  control('version-02', 'version', 'Upgraded the runtime to node 22.14.0 across all services.'),
  control('version-03', 'version', 'electron 40.9.2 changelog review'),
  control('version-04', 'version', 'Pinned typescript 5.7.3 in the monorepo.'),
  control('ipv4-01', 'ipv4', 'ssh deploy@192.168.1.100 failed with a timeout.'),
  control('ipv4-02', 'ipv4', 'curl http://10.0.0.5:8080/health returned 200.'),
  control('ipv4-03', 'ipv4', 'Switched the resolver to 8.8.8.8 while debugging DNS.'),
  control('uuid-01', 'uuid', 'activity 550e8400-e29b-41d4-a716-446655440000 missing embedding'),
  control(
    'uuid-02',
    'uuid',
    'GET /api/clusters/3f2a9c81-77de-4b02-9e41-c05a12ef88a3 returned 404.',
  ),
  control('sha-01', 'sha', 'git checkout a1b2c3d4e5f6 to bisect the regression'),
  control('sha-02', 'sha', 'Cherry-picked commit 8dffde5 onto the release branch.'),
  control('order-01', 'order', 'Invoice INV-2026-0148 sent to the client portal.'),
  control('order-02', 'order', 'Order #112-9384756-1029384 shipped - Amazon'),
  control('order-03', 'order', 'UPS tracking 1Z999AA10123456784 out for delivery'),
  control('order-04', 'order', 'PO 4500012877 pending approval in SAP.'),
  control('ticket-01', 'ticket', 'Fix login flow (#4821) - Pull Request'),
  control('ticket-02', 'ticket', 'DEU-205 add PII filtering - Linear'),
  control('ticket-03', 'ticket', 'Merged PR #243 after the second review pass.'),
  control('ticket-04', 'ticket', 'JIRA OPS-11842: rotate the staging certificates'),
  control('path-01', 'path', 'src/main/utils/paths.ts:104 - Visual Studio Code'),
  control(
    'path-02',
    'path',
    'Opened https://github.com/acme/platform/pull/247/files in the browser.',
  ),
  control('timestamp-01', 'timestamp', 'Build finished at 14:05:33 after 212 seconds.'),
  control('timestamp-02', 'timestamp', 'Cron fired at 2026-07-27T09:15:00Z as scheduled.'),
  control('count-01', 'count', 'Processed 48213 activities during the backfill.'),
  control('count-02', 'count', 'The table now holds 1048576 rows after the import.'),
  control('count-03', 'count', 'Benchmark completed 100000 iterations in 4.2s.'),
  control('zip-01', 'zip', 'Warehouse coverage map for ZIP 43215 - Tableau'),
  control('room-01', 'misc', 'Room 4155 reserved for the offsite workshop.'),
  control('ext-01', 'misc', 'Reach the desk at ext. 8842 during business hours.'),
  control('port-01', 'misc', 'The dev server listens on localhost:5173 by default.'),
  control('hex-01', 'misc', 'Trace id 7f3c9a2b1d8e4f60 logged at warn level.'),
  control('math-01', 'misc', 'Split the dataset 80/20 for the holdout evaluation.'),
  control('phone-like-01', 'misc', 'Error code 0x80070005 during the update rollback.'),
  control('title-01', 'misc', 'Quarterly business review agenda - Google Docs'),
  control('title-02', 'misc', 'Untitled spreadsheet - Google Sheets'),
  control('abn-01', 'company_id', 'Harbourline Logistics Pty Ltd, ABN 51 824 753 556'),
  control('abn-02', 'company_id', 'Supplier 51 824 753 556 approved for the panel.'),
  control('acn-01', 'company_id', 'ACN 004 085 616 listed on the tax invoice.'),
  control('nzbn-01', 'company_id', 'NZBN 9429041234567 registered in Auckland.'),
  control('bsb-01', 'company_id', 'Remit to BSB 062-000 at the Sydney branch.'),
  control('aunz-misc-01', 'misc', 'Reference batch 4820 1174 9930 2217 in the vendor export.'),
  control('aunz-misc-02', 'misc', 'Container limit 8192 MB, exit code 137 on retry.'),
  control('aunz-misc-03', 'misc', 'Invoice total 12 500 AUD, up 15% on Q3 2026.'),
]
