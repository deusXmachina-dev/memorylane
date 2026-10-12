import type { RecordingScript } from '@/shared/eval-review'

const EDITOR = ['TextEdit', 'Notepad']
const BROWSER = ['browser']

export const RECORDING_SCRIPTS: RecordingScript[] = [
  {
    id: 'app-switch-basic',
    title: 'Note, then a web search',
    targets: ['app switch splits activities'],
    setup: [
      { text: 'TextEdit open with a blank document' },
      { text: 'Chrome open on Google', url: 'https://www.google.com' },
    ],
    steps: [
      {
        instruction: 'In TextEdit, type "Call Dana about the Q3 freight invoice".',
        seconds: 10,
        expect: {
          app: EDITOR,
          summary: 'Wrote a note reading "Call Dana about the Q3 freight invoice" in TextEdit.',
          mustMention: ['Dana', 'freight invoice'],
        },
      },
      {
        instruction:
          'Click the Chrome window. Search Google for "freight invoice template" and look over the results for ~10s.',
        seconds: 10,
        expect: {
          app: BROWSER,
          tld: 'www.google.com',
          summary: 'Searched Google for "freight invoice template" and looked over the results.',
          mustMention: ['freight invoice template'],
        },
      },
    ],
  },
  {
    id: 'tld-change-vs-same-site',
    title: 'Same-site link, then a different site',
    targets: ['same-tld navigation merges', 'tld change splits'],
    setup: [
      {
        text: 'Chrome open on the Shipping container article',
        url: 'https://en.wikipedia.org/wiki/Shipping_container',
      },
    ],
    steps: [
      {
        instruction:
          'Read the intro for ~10s, then click the "intermodal freight transport" link and read that page for ~10s.',
        seconds: 20,
        expect: {
          app: BROWSER,
          tld: 'en.wikipedia.org',
          summary:
            'Read the Wikipedia article on shipping containers, then followed a link to the article on intermodal freight transport.',
          mustMention: ['shipping container', 'intermodal'],
        },
      },
      {
        instruction:
          'In the address bar, go to https://github.com/electron/electron and scroll through the README for ~10s.',
        seconds: 10,
        expect: {
          app: BROWSER,
          tld: 'github.com',
          summary:
            'Opened the electron/electron repository on GitHub and scrolled through its README.',
          mustMention: ['electron'],
        },
      },
    ],
  },
  {
    id: 'title-change-one-app',
    title: 'Two documents in one app',
    targets: ['title change in one app merges'],
    setup: [{ text: 'TextEdit with two documents open, saved as groceries.txt and todo.txt' }],
    steps: [
      {
        instruction:
          'In groceries.txt, type "eggs, oat milk". Switch to todo.txt (Cmd+`) and type "renew passport".',
        seconds: 15,
        expect: {
          app: EDITOR,
          summary:
            'Added "eggs, oat milk" to groceries.txt, then switched to todo.txt and added "renew passport".',
          mustMention: ['groceries', 'oat milk', 'todo', 'renew passport'],
        },
      },
    ],
  },
  {
    id: 'short-hop-dropped',
    title: 'Brief detour is ignored',
    targets: ['<3s visit dropped'],
    setup: [{ text: 'TextEdit open with a blank document' }, { text: 'Chrome open on any page' }],
    steps: [
      {
        instruction: 'In TextEdit, type "Draft agenda: budget, hiring".',
        seconds: 8,
        expect: {
          app: EDITOR,
          summary: 'Wrote a draft agenda listing budget and hiring in TextEdit.',
          mustMention: ['agenda', 'budget', 'hiring'],
        },
      },
      {
        instruction: 'Cmd+Tab to Chrome and straight back to TextEdit (under 2s).',
        seconds: 2,
        expect: { app: BROWSER, dropped: true },
      },
      {
        instruction: 'Add ", offsite" to the agenda.',
        seconds: 8,
        expect: {
          app: EDITOR,
          summary: 'Added "offsite" to the draft agenda in TextEdit.',
          mustMention: ['offsite'],
        },
      },
    ],
  },
  {
    id: 'passive-view-short',
    title: 'Hands-off glance',
    targets: ['no-input view under 60s gets a heuristic summary'],
    setup: [
      { text: 'TextEdit open with a blank document' },
      { text: 'Chrome open on the Pallet article', url: 'https://en.wikipedia.org/wiki/Pallet' },
    ],
    steps: [
      {
        instruction: 'In TextEdit, type "pallet notes".',
        seconds: 6,
        expect: {
          app: EDITOR,
          summary: 'Wrote "pallet notes" in TextEdit.',
          mustMention: ['pallet notes'],
        },
      },
      {
        instruction: 'Cmd+Tab to Chrome, then take your hands off the keyboard and mouse.',
        seconds: 20,
        expect: { app: BROWSER, tld: 'en.wikipedia.org' },
      },
    ],
  },
  {
    id: 'passive-read-scroll',
    title: 'Long read with scrolling',
    targets: ['scroll-only activity gets an LLM summary'],
    setup: [
      {
        text: 'Chrome open on the Incoterms article',
        url: 'https://en.wikipedia.org/wiki/Incoterms',
      },
    ],
    steps: [
      {
        instruction: 'Read and scroll down to the list of rules.',
        seconds: 60,
        expect: {
          app: BROWSER,
          tld: 'en.wikipedia.org',
          summary:
            'Read the Wikipedia article on Incoterms, scrolling down through the list of trade rules.',
          mustMention: ['Incoterms'],
        },
      },
    ],
  },
  {
    id: 'idle-gap-mid-task',
    title: 'Pause in the middle of a task',
    targets: ['idle gap inside one app stays one activity'],
    setup: [{ text: 'TextEdit open with a blank document' }],
    steps: [
      {
        instruction:
          'Type "Supplier shortlist:". Take your hands off for 10s. Then type " Acme Pallets, Nordic Crates".',
        seconds: 25,
        expect: {
          app: EDITOR,
          summary:
            'Started a supplier shortlist in TextEdit, listing Acme Pallets and Nordic Crates.',
          mustMention: ['Acme Pallets', 'Nordic Crates'],
        },
      },
    ],
  },
  {
    id: 'keyboard-shortcuts-copy',
    title: 'Copy into a new document',
    targets: ['key-sequence evidence', 'title change in one app merges'],
    setup: [{ text: 'TextEdit open with a document containing a few lines of text' }],
    steps: [
      {
        instruction:
          'Cmd+A, Cmd+C, Cmd+N, Cmd+V, then Cmd+S and save the new document as "backup-notes".',
        seconds: 20,
        expect: {
          app: EDITOR,
          summary:
            'Copied all the text from a TextEdit document into a new document and saved it as "backup-notes".',
          mustMention: ['backup-notes'],
        },
      },
    ],
  },
  {
    id: 'finder-drag',
    title: 'Drag a file into a folder',
    targets: ['drag evidence'],
    setup: [
      { text: 'Finder window showing invoice-4411.pdf (rename any PDF)' },
      { text: 'A folder named Paid next to it' },
    ],
    steps: [
      {
        instruction:
          'Drag invoice-4411.pdf onto the Paid folder, then double-click Paid to open it.',
        seconds: 15,
        expect: {
          app: ['Finder', 'explorer'],
          summary:
            'Moved invoice-4411.pdf into the "Paid" folder in Finder and opened the folder to confirm it was there.',
          mustMention: ['invoice-4411', 'Paid'],
        },
      },
    ],
  },
  {
    id: 'copy-paste-across-apps',
    title: 'Copy a value into a web form',
    targets: ['cross-app copy/paste'],
    setup: [
      { text: 'TextEdit document containing "PO-77812"' },
      { text: 'Chrome open on the httpbin order form', url: 'https://httpbin.org/forms/post' },
    ],
    steps: [
      {
        instruction: 'In TextEdit, double-click PO-77812 and press Cmd+C.',
        seconds: 5,
        expect: {
          app: EDITOR,
          summary: 'Copied the purchase order number "PO-77812" from a TextEdit document.',
          mustMention: ['PO-77812'],
        },
      },
      {
        instruction: 'Click the Chrome window and paste into "Delivery instructions".',
        seconds: 8,
        expect: {
          app: BROWSER,
          tld: 'httpbin.org',
          summary:
            'Pasted the purchase order number "PO-77812" into the delivery instructions of a web order form.',
          mustMention: ['PO-77812', 'delivery instructions'],
        },
      },
    ],
  },
  {
    id: 'form-fill-tabbing',
    title: 'Fill and submit a web form',
    targets: ['typing + Tab evidence', 'same-tld submit merges'],
    setup: [
      { text: 'Chrome open on the httpbin order form', url: 'https://httpbin.org/forms/post' },
    ],
    steps: [
      {
        instruction:
          'Fill in name "Jana Novak", Tab, phone "555-0142", Tab, email "jana@acme.test". Pick Medium, tick Mushroom, click Submit order.',
        seconds: 30,
        expect: {
          app: BROWSER,
          tld: 'httpbin.org',
          summary:
            'Filled out a pizza order form for Jana Novak (555-0142, jana@acme.test), chose a medium pizza with mushroom, and submitted it.',
          mustMention: ['Jana Novak', 'jana@acme.test', 'medium', 'mushroom'],
        },
      },
    ],
  },
  {
    id: 'spreadsheet-edit',
    title: 'Enter values in a spreadsheet',
    targets: ['cell-entry evidence'],
    setup: [{ text: 'Numbers or Excel open on a blank sheet' }],
    steps: [
      {
        instruction:
          'Type Supplier / Price in row 1, Acme Pallets / 12.50 in row 2, Nordic Crates / 14.20 in row 3.',
        seconds: 30,
        expect: {
          app: ['Numbers', 'Microsoft Excel', 'EXCEL'],
          summary:
            'Started a supplier price table in a spreadsheet, entering Acme Pallets at 12.50 and Nordic Crates at 14.20.',
          mustMention: ['Acme Pallets', '12.50', 'Nordic Crates', '14.20'],
        },
      },
    ],
  },
]

export function getRecordingScript(id: string): RecordingScript | null {
  return RECORDING_SCRIPTS.find((s) => s.id === id) ?? null
}
