import { describe, expect, it } from 'vitest'
import {
  passesAbn,
  passesAcn,
  passesIrd,
  passesLuhn,
  passesMedicare,
  passesNhi,
  passesTfn,
  scrubPII,
} from './sanitize'

const OPENAI_KEY = 'sk-' + 'proj-Ab12Cd34Ef56Gh78Ij90'
const GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'
const GH_PAT = 'github_pat_' + '11ABCDEFG0abcdefghijklmnop'
const AWS_KEY_ID = 'AKIA' + 'IOSFODNN7EXAMPLE'
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P'

describe('checksum validators', () => {
  it('accepts published valid numbers and rejects one-digit variants', () => {
    expect(passesAbn('51 824 753 556')).toBe(true)
    expect(passesAbn('51 824 753 557')).toBe(false)

    expect(passesAcn('004 085 616')).toBe(true)
    expect(passesAcn('004 085 617')).toBe(false)

    expect(passesTfn('123 456 782')).toBe(true)
    expect(passesTfn('123 456 789')).toBe(false)

    expect(passesMedicare('2123 45670 1')).toBe(true)
    expect(passesMedicare('2123 45671 1')).toBe(false)

    expect(passesIrd('49-091-850')).toBe(true)
    expect(passesIrd('49-091-851')).toBe(false)

    expect(passesNhi('ZAC5361')).toBe(true)
    expect(passesNhi('ZAC5362')).toBe(false)

    expect(passesLuhn('4111111111111111')).toBe(true)
    expect(passesLuhn('4111111111111112')).toBe(false)
  })

  it('rejects numbers of the wrong length or out of the issued range', () => {
    expect(passesTfn('12 345 678')).toBe(false)
    expect(passesAbn('51 824 753 55')).toBe(false)
    expect(passesMedicare('2123 4567')).toBe(false)
    expect(passesIrd('12-345-678')).toBe(false)
  })

  it('rejects Medicare numbers outside the published first-digit range', () => {
    expect(passesMedicare('1123 45670 1')).toBe(false)
    expect(passesMedicare('7123 45670 1')).toBe(false)
  })

  it('treats the Medicare IRN as outside the checksum', () => {
    expect(passesMedicare('2123 45670 1')).toBe(true)
    expect(passesMedicare('2123 45670 9')).toBe(true)
  })
})

describe('scrubPII — Australian identifiers', () => {
  it('types tax file and Medicare numbers', () => {
    expect(scrubPII('Tax file number 123 456 782')).toBe('Tax file number [tax file number]')
    expect(scrubPII('TFN: 123456782')).toBe('TFN: [tax file number]')
    expect(scrubPII('Medicare 2123 45670 1')).toBe('Medicare [medicare number]')
  })

  it('detects an unlabelled Medicare number by checksum', () => {
    expect(scrubPII('card shows 2123 45670 1 on it')).toBe('card shows [medicare number] on it')
  })

  it('leaves an unlabelled nine-digit run alone rather than guessing TFN', () => {
    expect(scrubPII('batch 123 456 782 processed')).toBe('batch 123 456 782 processed')
  })

  it('redacts an account number but keeps the BSB', () => {
    expect(scrubPII('BSB 062-000, account 12345678')).toBe('BSB 062-000, account [bank account]')
  })

  it('redacts the account when only the BSB is labelled', () => {
    expect(scrubPII('Remit to BSB 062-000, 12345678')).toBe('Remit to BSB 062-000, [bank account]')
    expect(scrubPII('BSB 062-000 / 12345678')).toBe('BSB 062-000 / [bank account]')
    expect(scrubPII('BSB 062-000 Acct 12345678')).toBe('BSB 062-000 Acct [bank account]')
    expect(scrubPII('BSB 062-000 A/C 12345678')).toBe('BSB 062-000 A/C [bank account]')
  })

  it('keeps space-grouped money after a bank label', () => {
    expect(scrubPII('Account 4 500 000 AUD in the ledger')).toBe(
      'Account 4 500 000 AUD in the ledger',
    )
  })

  it('types passports, licences and Centrelink references', () => {
    expect(scrubPII('Passport PA0941234 expires soon')).toBe('Passport [id number] expires soon')
    expect(scrubPII('Drivers licence 04829173')).toBe('Drivers licence [id number]')
    expect(scrubPII('Centrelink CRN 203 456 789A is on file')).toBe(
      'Centrelink CRN [id number] is on file',
    )
  })

  it('matches Australian phone formats', () => {
    expect(scrubPII('call +61 412 345 678 now')).toBe('call [phone number] now')
    expect(scrubPII('call 0412 987 654 now')).toBe('call [phone number] now')
    expect(scrubPII('call 03 9876 5432 now')).toBe('call [phone number] now')
  })
})

describe('scrubPII — New Zealand identifiers', () => {
  it('types IRD and NHI numbers', () => {
    expect(scrubPII('IRD 49-091-850')).toBe('IRD [ird number]')
    expect(scrubPII('NHI ZAC5361 on the referral')).toBe('NHI [nhi number] on the referral')
  })

  it('types a GST number but keeps a GST amount', () => {
    expect(scrubPII('GST 49091850 filed')).toBe('GST [ird number] filed')
    expect(scrubPII('GST 100 000 payable this quarter')).toBe('GST 100 000 payable this quarter')
  })

  it('detects an unlabelled IRD number by checksum and range', () => {
    expect(scrubPII('files under 136-410-132 this year')).toBe('files under [ird number] this year')
  })

  it('types a New Zealand bank account', () => {
    expect(scrubPII('paid into 01-0123-0123456-00')).toBe('paid into [bank account]')
  })

  it('matches New Zealand phone formats', () => {
    expect(scrubPII('call +64 21 555 0134 now')).toBe('call [phone number] now')
    expect(scrubPII('call 021 555 0198 now')).toBe('call [phone number] now')
  })
})

describe('scrubPII — company identifiers stay', () => {
  it('keeps ABN, ACN and NZBN — public registry data carrying org signal', () => {
    expect(scrubPII('Harbourline trades as ABN 51 824 753 556')).toBe(
      'Harbourline trades as ABN 51 824 753 556',
    )
    expect(scrubPII('ACN 004 085 616 on the invoice')).toBe('ACN 004 085 616 on the invoice')
    expect(scrubPII('NZBN 9429041234567 registered')).toBe('NZBN 9429041234567 registered')
  })

  it('keeps a valid ABN even unlabelled, where a bare digit rule would redact it', () => {
    expect(scrubPII('supplier 51 824 753 556 approved')).toBe('supplier 51 824 753 556 approved')
  })

  it('redacts a labelled identifier that also satisfies a company checksum', () => {
    expect(passesTfn('100000182') && passesAcn('100000182')).toBe(true)
    expect(scrubPII('Tax file number 100000182')).toBe('Tax file number [tax file number]')
    expect(scrubPII('Tax file number 100 000 182')).toBe('Tax file number [tax file number]')
    expect(passesAbn('51824753556')).toBe(true)
    expect(scrubPII('Account number 51824753556')).toBe('Account number [bank account]')
  })
})

describe('scrubPII — universal classes', () => {
  it('replaces secret-shaped tokens', () => {
    expect(scrubPII(`export OPENAI_API_KEY=${OPENAI_KEY}`)).toBe(
      'export OPENAI_API_KEY=[redacted secret]',
    )
    expect(scrubPII(`git push with ${GH_TOKEN}`)).toBe('git push with [redacted secret]')
    expect(scrubPII(`token ${GH_PAT} created`)).toBe('token [redacted secret] created')
    expect(scrubPII(`aws configure ${AWS_KEY_ID}`)).toBe('aws configure [redacted secret]')
    expect(scrubPII(`Authorization: Bearer ${JWT}`)).toBe('Authorization: Bearer [redacted secret]')
  })

  it('replaces labeled secrets, passwords, birth dates and employee ids', () => {
    expect(scrubPII('api_key: 9f8e7d6c5b4a')).toBe('api_key: [redacted secret]')
    expect(scrubPII('password: Tr0ub4dor&3')).toBe('password: [redacted password]')
    expect(scrubPII('Temporary password\nSumm3r!2026\nChange it')).toBe(
      'Temporary password\n[redacted password]\nChange it',
    )
    expect(scrubPII('DOB: 04/12/1985')).toBe('DOB: [redacted date of birth]')
    expect(scrubPII('Employee ID: EMP-04481')).toBe('Employee ID: [redacted employee id]')
  })

  it('leaves the sentence punctuation that follows a credential', () => {
    expect(scrubPII('Set password: hunter42, then log in')).toBe(
      'Set password: [redacted password], then log in',
    )
    expect(scrubPII('api_key: 9f8e7d6c5b4a.')).toBe('api_key: [redacted secret].')
  })

  it('redacts the value, not the label, when the value repeats the label', () => {
    expect(scrubPII('password: password')).toBe('password: [redacted password]')
    expect(scrubPII('pass = pass')).toBe('pass = [redacted password]')
    expect(scrubPII('api_key: api_key123')).toBe('api_key: [redacted secret]')
  })

  it('requires a valid Luhn before claiming a payment card', () => {
    expect(scrubPII('card 4111 1111 1111 1111')).toBe('card [payment card]')
    expect(scrubPII('batch 4820 1174 9930 2217 shipped')).toBe('batch 4820 1174 9930 2217 shipped')
  })

  it('replaces US social security numbers', () => {
    expect(scrubPII('SSN 078-05-1120')).toBe('SSN [id number]')
  })
})

describe('scrubPII — what must survive', () => {
  it('keeps names and emails, the client-vs-internal signal', () => {
    expect(scrubPII('sarah.chen@harbourline.com.au asked Tom Whitaker to sign')).toBe(
      'sarah.chen@harbourline.com.au asked Tom Whitaker to sign',
    )
  })

  it('keeps technical identifiers', () => {
    const text =
      'Ticket DEU-205 on 3f2a9c1e-7b44-4d0a-9e21-8c5f6b0d1234, log memorylane-2026-08-06T11-42-07.log, ' +
      'host 10.0.14.203:5432, build v1.5.5-alpha.2, commit 67221f6'
    expect(scrubPII(text)).toBe(text)
  })

  it('keeps ordinary business numbers and prose', () => {
    expect(scrubPII('processed 1 000 000 rows in 4 steps')).toBe(
      'processed 1 000 000 rows in 4 steps',
    )
    expect(scrubPII('Q3 2026 revenue 12 500 AUD, up 15%')).toBe(
      'Q3 2026 revenue 12 500 AUD, up 15%',
    )
    expect(scrubPII('container limit 8192 MB, exit code 137')).toBe(
      'container limit 8192 MB, exit code 137',
    )
    expect(scrubPII('NetSuite > Payables > Harbourline')).toBe('NetSuite > Payables > Harbourline')
    expect(scrubPII('INV-2026-0417 due 2026-04-01')).toBe('INV-2026-0417 due 2026-04-01')
  })

  it('returns empty input unchanged', () => {
    expect(scrubPII('')).toBe('')
  })
})
